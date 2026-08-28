import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AllergenCode,
  CostingDto,
  DraftCostingDto,
  ExplodedLineDto,
  PriceSuggestionDto,
  PriceSuggestionQuery,
  RecipeLineDto,
} from '@warekai/contracts';
import {
  Decimal,
  Money,
  Quantity,
  buildUnitCostIndex,
  calculateRecipeCost,
  foodCostRatio,
  netPriceFromGross,
  priceForTargetFoodCost,
  propagateAllergens,
  scaleRecipe,
  type Catalog,
  type CostBreakdown,
  type RecipeBook,
  type RecipeNode,
} from '@warekai/domain';
import { eq, isNull } from 'drizzle-orm';
import { assertPermission, type Principal } from '../../common/principal';
import type { Database } from '../../db/client';
import * as t from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { toCatalog, toRecipeBook, type RecipeRowForDomain } from './domain-mapping';

/** Estado del recetario cargado en memoria, listo para el motor. */
export interface DomainState {
  catalog: Catalog;
  recipes: RecipeBook;
  /** Metadatos que el motor no necesita pero la respuesta si. */
  recipeMeta: Map<string, { recipeId: string; versionNo: number; listPriceCents: number | null }>;
  vatByItemId: Map<string, string>;
}

@Injectable()
export class CostingService {
  /**
   * Carga catalogo y recetario vigentes de una vez.
   *
   * Se trae todo el recetario en lugar de recorrer el arbol con consultas
   * anidadas. Un recetario de restaurante son cientos de filas, no millones, y
   * la alternativa es una consulta por nivel de anidamiento: justo el patron
   * que hace lento un escandallo de cuatro niveles.
   */
  async loadDomainState(tx: Database): Promise<DomainState> {
    const itemRows = await tx.query.items.findMany({ with: { allergens: true } });
    const recipeRows = await tx.query.recipes.findMany({
      with: { lines: true },
      where: isNull(t.recipes.validTo),
    });

    const catalog = toCatalog(
      itemRows.map((row) => ({
        id: row.id,
        name: row.name,
        kinds: row.kinds,
        purchaseUnitLabel: row.purchaseUnitLabel,
        stockUnitLabel: row.stockUnitLabel,
        usageUnit: row.usageUnit,
        purchaseToStock: row.purchaseToStock,
        stockToUsage: row.stockToUsage,
        densityGPerMl: row.densityGPerMl,
        weightPerPieceG: row.weightPerPieceG,
        purchasePriceCents: row.purchasePriceCents,
        cleaningYield: row.cleaningYield,
        vatRate: row.vatRate,
        allergens: row.allergens.map((a) => ({
          code: a.allergenCode as AllergenCode,
          level: a.level,
        })),
      })),
    );

    const recipes = toRecipeBook(recipeRows.map(toRecipeRowForDomain));

    return {
      catalog,
      recipes,
      recipeMeta: new Map(
        recipeRows.map((row) => [
          row.itemId,
          { recipeId: row.id, versionNo: row.versionNo, listPriceCents: row.listPriceCents },
        ]),
      ),
      vatByItemId: new Map(itemRows.map((row) => [row.id, row.vatRate])),
    };
  }

  async getForRecipe(principal: Principal, recipeId: string): Promise<CostingDto> {
    assertPermission(principal, 'cost:read');

    return withTenant(principal.tenantId, async (tx) => {
      const [recipe] = await tx.select().from(t.recipes).where(eq(t.recipes.id, recipeId)).limit(1);
      if (!recipe) {
        throw new NotFoundException({ code: 'UNKNOWN_RECIPE', message: 'La receta no existe.' });
      }
      const state = await this.loadDomainState(tx);
      const breakdown = calculateRecipeCost(recipe.itemId, state.catalog, state.recipes);
      return this.toDto(recipeId, breakdown, state, recipe.listPriceCents);
    });
  }

  /**
   * Escandallo de unas lineas que aun no se han guardado.
   *
   * Es lo que alimenta el coste en vivo del editor. La regla de calculo sigue
   * viviendo en `packages/domain`: el navegador manda lo que hay en pantalla y
   * recibe el numero, en vez de reimplementar la doble merma en React y que
   * las dos versiones se separen con el tiempo.
   */
  async getForDraft(principal: Principal, draft: DraftCostingDto): Promise<CostingDto> {
    assertPermission(principal, 'cost:read');

    return withTenant(principal.tenantId, async (tx) => {
      const state = await this.loadDomainState(tx);

      const draftNode: RecipeNode = {
        itemId: draft.itemId,
        yieldFactor: new Decimal(draft.yieldFactor),
        outputQuantity: Quantity.of(draft.outputQuantity, draft.outputUnit),
        portions: draft.portions,
        lines: draft.lines.map((line) => ({
          itemId: line.itemId,
          quantity: Quantity.of(line.quantity, line.unit),
          ...(line.cleaningYieldOverride
            ? { cleaningYieldOverride: new Decimal(line.cleaningYieldOverride) }
            : {}),
        })),
      };

      // El borrador sustituye a la version guardada de este item: si el resto
      // del recetario lo usa, vera el coste nuevo. Es justo lo que interesa ver
      // mientras se edita una elaboracion intermedia.
      const recipes = new Map(state.recipes);
      recipes.set(draft.itemId, draftNode);

      const breakdown = calculateRecipeCost(draft.itemId, state.catalog, recipes);
      const meta = state.recipeMeta.get(draft.itemId);
      return this.toDto(
        meta?.recipeId ?? DRAFT_RECIPE_ID,
        breakdown,
        { ...state, recipes },
        draft.listPriceCents,
      );
    });
  }

  async getPriceSuggestion(
    principal: Principal,
    recipeId: string,
    query: PriceSuggestionQuery,
  ): Promise<PriceSuggestionDto> {
    assertPermission(principal, 'cost:read');

    return withTenant(principal.tenantId, async (tx) => {
      const [recipe] = await tx.select().from(t.recipes).where(eq(t.recipes.id, recipeId)).limit(1);
      if (!recipe) {
        throw new NotFoundException({ code: 'UNKNOWN_RECIPE', message: 'La receta no existe.' });
      }
      const state = await this.loadDomainState(tx);
      const breakdown = calculateRecipeCost(recipe.itemId, state.catalog, state.recipes);
      const vatRate = new Decimal(state.vatByItemId.get(recipe.itemId) ?? '0.10');

      const suggestion = priceForTargetFoodCost(
        breakdown.costPerPortion,
        new Decimal(query.targetFoodCost),
        vatRate,
        { rounding: query.rounding },
      );

      return {
        netPriceCents: suggestion.netPrice.exactCents.toFixed(4),
        vatAmountCents: suggestion.vatAmount.exactCents.toFixed(4),
        grossPriceCents: suggestion.grossPrice.exactCents.toFixed(4),
        roundedGrossPriceCents: suggestion.roundedGrossPrice.cents,
        roundedNetPriceCents: suggestion.roundedNetPrice.exactCents.toFixed(4),
        effectiveFoodCost: suggestion.effectiveFoodCost.toFixed(6),
        grossMarginCents: suggestion.grossMargin.exactCents.toFixed(4),
      };
    });
  }

  /** Escalado de una receta a N raciones, para la ficha de produccion. */
  async scale(
    principal: Principal,
    recipeId: string,
    portions: number,
  ): Promise<{
    portions: number;
    lines: Array<Pick<RecipeLineDto, 'itemId' | 'itemName' | 'quantity' | 'unit'>>;
  }> {
    assertPermission(principal, 'recipe:read');

    return withTenant(principal.tenantId, async (tx) => {
      const recipe = await tx.query.recipes.findFirst({
        where: eq(t.recipes.id, recipeId),
        with: { lines: true },
      });
      if (!recipe) {
        throw new NotFoundException({ code: 'UNKNOWN_RECIPE', message: 'La receta no existe.' });
      }
      const state = await this.loadDomainState(tx);
      const scaled = scaleRecipe(toRecipeBookNode(recipe), portions);

      return {
        portions: scaled.portions,
        lines: scaled.lines.map((line) => ({
          itemId: line.itemId,
          itemName: state.catalog.get(line.itemId)?.name ?? line.itemId,
          quantity: line.quantity.amount.toFixed(3),
          unit: line.quantity.unit,
        })),
      };
    });
  }

  /**
   * Recalcula y congela el coste de las recetas indicadas.
   *
   * Lo llama el trabajo en cola. Devuelve cuantas ha escrito para poder
   * registrarlo en el log del trabajo.
   */
  async refreshSnapshots(tenantId: string, recipeItemIds: readonly string[]): Promise<number> {
    return withTenant(tenantId, async (tx) => {
      const state = await this.loadDomainState(tx);
      const targets =
        recipeItemIds.length > 0
          ? recipeItemIds.filter((id) => state.recipes.has(id))
          : [...state.recipes.keys()];

      const index = buildUnitCostIndex(state.catalog, state.recipes);
      let written = 0;

      for (const itemId of targets) {
        const meta = state.recipeMeta.get(itemId);
        if (!meta) continue;
        const breakdown = calculateRecipeCost(itemId, state.catalog, state.recipes, index);
        const vatRate = new Decimal(state.vatByItemId.get(itemId) ?? '0.10');
        const ratio =
          meta.listPriceCents === null
            ? null
            : foodCostRatio(
                breakdown.costPerPortion,
                netPriceFromGross(Money.fromCents(meta.listPriceCents), vatRate),
              );

        await tx.insert(t.costSnapshots).values({
          tenantId,
          recipeId: meta.recipeId,
          recipeVersionNo: meta.versionNo,
          totalCostCents: breakdown.totalCost.cents,
          costPerPortionCents: breakdown.costPerPortion.cents,
          costPerOutputUnitCents: breakdown.costPerOutputUnit.exactCents.toFixed(6),
          listPriceCents: meta.listPriceCents,
          foodCostRatio: ratio ? ratio.toFixed(6) : null,
          breakdown: this.toDto(meta.recipeId, breakdown, state, meta.listPriceCents) as object,
        });
        written += 1;
      }
      return written;
    });
  }

  // --- Internos --------------------------------------------------------------

  private toDto(
    recipeId: string,
    breakdown: CostBreakdown,
    state: DomainState,
    listPriceCents: number | null,
  ): CostingDto {
    const vatRate = new Decimal(state.vatByItemId.get(breakdown.itemId) ?? '0.10');
    const netPrice =
      listPriceCents === null ? null : netPriceFromGross(Money.fromCents(listPriceCents), vatRate);

    const total = breakdown.totalCost.exactCents;
    const lines: ExplodedLineDto[] = breakdown.lines.map((line) => ({
      itemId: line.itemId,
      itemName: line.itemName,
      path: [...line.path],
      depth: line.depth,
      isPreparation: line.isPreparation,
      netQuantity: line.netQuantity.amount.toFixed(4),
      netUnit: line.netQuantity.unit,
      grossQuantity: line.grossQuantity.amount.toFixed(4),
      grossUnit: line.grossQuantity.unit,
      cleaningYield: line.cleaningYield.toString(),
      unitCostCents: line.unitCost.exactCents.toFixed(8),
      lineCostCents: line.lineCost.exactCents.toFixed(4),
      shareOfTotal: total.isZero() ? '0' : line.lineCost.exactCents.dividedBy(total).toFixed(6),
    }));

    return {
      recipeId,
      itemId: breakdown.itemId,
      itemName: breakdown.itemName,
      totalCostCents: breakdown.totalCost.cents,
      costPerPortionCents: breakdown.costPerPortion.cents,
      portions: breakdown.portions,
      netOutputQuantity: breakdown.netOutput.amount.toFixed(4),
      netOutputUnit: breakdown.netOutput.unit,
      costPerOutputUnitCents: breakdown.costPerOutputUnit.exactCents.toFixed(6),
      listPriceCents,
      vatRate: vatRate.toString(),
      foodCostRatio: netPrice ? foodCostRatio(breakdown.costPerPortion, netPrice).toFixed(6) : null,
      grossMarginCents: netPrice ? netPrice.minus(breakdown.costPerPortion).cents : null,
      allergens: propagateAllergens(breakdown.itemId, state.catalog, state.recipes),
      lines,
      calculatedAt: new Date().toISOString(),
    };
  }
}

/** Identificador ficticio para un escandallo que aun no se ha guardado. */
const DRAFT_RECIPE_ID = '00000000-0000-4000-8000-000000000000';

type RecipeWithLines = typeof t.recipes.$inferSelect & {
  lines: (typeof t.recipeLines.$inferSelect)[];
};

function toRecipeRowForDomain(row: RecipeWithLines): RecipeRowForDomain {
  return {
    itemId: row.itemId,
    yieldFactor: row.yieldFactor,
    outputQuantity: row.outputQuantity,
    outputUnit: row.outputUnit,
    portions: row.portions,
    lines: row.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      unit: line.unit,
      cleaningYieldOverride: line.cleaningYieldOverride,
    })),
  };
}

function toRecipeBookNode(row: RecipeWithLines): RecipeNode {
  return toRecipeBook([toRecipeRowForDomain(row)]).get(row.itemId) as RecipeNode;
}

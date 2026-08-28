import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateRecipeDto,
  Paginated,
  RecipeDto,
  RecipeListEntryDto,
  RecipeQuery,
  UpdateRecipeDto,
} from '@warekai/contracts';
import { findCycle, Decimal, Quantity } from '@warekai/domain';
import { and, asc, count, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { recordAuditFor } from '../../common/audit';
import { assertNotPinSession, assertPermission, type Principal } from '../../common/principal';
import type { Database } from '../../db/client';
import * as t from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { CostingService } from '../costing/costing.service';
import { RecalculationQueue } from '../jobs/recalculation.queue';

@Injectable()
export class RecipesService {
  constructor(
    private readonly costing: CostingService,
    private readonly recalculation: RecalculationQueue,
  ) {}

  async list(principal: Principal, query: RecipeQuery): Promise<Paginated<RecipeListEntryDto>> {
    assertPermission(principal, 'recipe:read');
    const canSeeCost = principal.roles.length > 0 && this.canReadCost(principal);

    return withTenant(principal.tenantId, async (tx) => {
      const target = await this.targetFoodCost(tx);

      const filters: SQL[] = [isNull(t.recipes.validTo)];
      if (query.search) filters.push(ilike(t.items.name, `%${query.search}%`));
      if (query.onlySale) {
        filters.push(sql`${t.items.kinds} @> ARRAY['SALE']::item_kind[]`);
      }
      const where = and(...filters);

      const [{ value: total } = { value: 0 }] = await tx
        .select({ value: count() })
        .from(t.recipes)
        .innerJoin(t.items, eq(t.recipes.itemId, t.items.id))
        .where(where);

      const rows = await tx
        .select({
          id: t.recipes.id,
          itemId: t.recipes.itemId,
          itemName: t.items.name,
          versionNo: t.recipes.versionNo,
          kinds: t.items.kinds,
          portions: t.recipes.portions,
          listPriceCents: t.recipes.listPriceCents,
          updatedAt: t.recipes.updatedAt,
          costPerPortionCents: latestSnapshot('cost_per_portion_cents'),
          foodCostRatio: latestSnapshot('food_cost_ratio'),
        })
        .from(t.recipes)
        .innerJoin(t.items, eq(t.recipes.itemId, t.items.id))
        .where(where)
        .orderBy(asc(t.items.name))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const mapped: RecipeListEntryDto[] = rows
        .filter((row) =>
          query.aboveTarget
            ? row.foodCostRatio !== null && Number(row.foodCostRatio) > Number(target)
            : true,
        )
        .map((row) => ({
          id: row.id,
          itemId: row.itemId,
          itemName: row.itemName,
          versionNo: row.versionNo,
          isSaleItem: row.kinds.includes('SALE'),
          portions: row.portions,
          // El cocinero de partida ve la ficha tecnica, no los margenes.
          costPerPortionCents:
            canSeeCost && row.costPerPortionCents !== null ? Number(row.costPerPortionCents) : null,
          listPriceCents: canSeeCost ? row.listPriceCents : null,
          foodCostRatio: canSeeCost ? (row.foodCostRatio ?? null) : null,
          updatedAt: row.updatedAt.toISOString(),
        }));

      return { items: mapped, total, page: query.page, pageSize: query.pageSize };
    });
  }

  async findOne(principal: Principal, id: string): Promise<RecipeDto> {
    assertPermission(principal, 'recipe:read');
    return withTenant(principal.tenantId, (tx) => this.loadRecipe(tx, id));
  }

  async create(principal: Principal, dto: CreateRecipeDto): Promise<RecipeDto> {
    assertPermission(principal, 'recipe:write');

    return withTenant(principal.tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: t.recipes.id })
        .from(t.recipes)
        .where(and(eq(t.recipes.itemId, dto.itemId), isNull(t.recipes.validTo)))
        .limit(1);
      if (existing) {
        throw new ConflictException({
          code: 'RECIPE_ALREADY_EXISTS',
          message: 'Este item ya tiene una receta vigente. Editala o abre una version nueva.',
        });
      }

      const [row] = await tx
        .insert(t.recipes)
        .values({
          tenantId: principal.tenantId,
          itemId: dto.itemId,
          versionNo: 1,
          yieldFactor: dto.yieldFactor,
          outputQuantity: dto.outputQuantity,
          outputUnit: dto.outputUnit,
          portions: dto.portions,
          listPriceCents: dto.listPriceCents,
          method: dto.method,
          createdByUserId: principal.userId,
        })
        .returning();
      if (!row) throw new Error('No se pudo crear la receta');

      await this.replaceLines(tx, principal.tenantId, row.id, dto.lines);
      await this.assertNoCycle(tx, dto.itemId);
      await recordAuditFor(tx, principal, 'CREATE', 'recipe', row.id, dto);
      await this.recalculation.enqueueForItem(principal.tenantId, dto.itemId);
      return this.loadRecipe(tx, row.id);
    });
  }

  async update(principal: Principal, id: string, dto: UpdateRecipeDto): Promise<RecipeDto> {
    assertPermission(principal, 'recipe:write');
    if (dto.listPriceCents !== undefined) {
      assertPermission(principal, 'price:write');
      assertNotPinSession(principal, 'cambiar precios de carta');
    }

    return withTenant(principal.tenantId, async (tx) => {
      const before = await this.loadRecipe(tx, id);

      const patch: Partial<typeof t.recipes.$inferInsert> = { updatedAt: new Date() };
      if (dto.yieldFactor !== undefined) patch.yieldFactor = dto.yieldFactor;
      if (dto.outputQuantity !== undefined) patch.outputQuantity = dto.outputQuantity;
      if (dto.outputUnit !== undefined) patch.outputUnit = dto.outputUnit;
      if (dto.portions !== undefined) patch.portions = dto.portions;
      if (dto.listPriceCents !== undefined) patch.listPriceCents = dto.listPriceCents;
      if (dto.method !== undefined) patch.method = dto.method;

      await tx.update(t.recipes).set(patch).where(eq(t.recipes.id, id));
      if (dto.lines !== undefined) {
        await this.replaceLines(tx, principal.tenantId, id, dto.lines);
      }
      await this.assertNoCycle(tx, before.itemId);
      await recordAuditFor(tx, principal, 'UPDATE', 'recipe', id, { before, after: dto });
      await this.recalculation.enqueueForItem(principal.tenantId, before.itemId);
      return this.loadRecipe(tx, id);
    });
  }

  /**
   * Cierra la version vigente y abre una nueva copiando sus lineas.
   *
   * Una receta no se sobrescribe cuando cambia de verdad: un escandallo firmado
   * hace seis meses tiene que poder reconstruirse tal como era, porque sostiene
   * una decision de precio que ya se tomo.
   */
  async publishNewVersion(principal: Principal, id: string): Promise<RecipeDto> {
    assertPermission(principal, 'recipe:write');

    return withTenant(principal.tenantId, async (tx) => {
      const current = await this.loadRecipe(tx, id);
      const now = new Date();

      await tx.update(t.recipes).set({ validTo: now }).where(eq(t.recipes.id, id));

      const [next] = await tx
        .insert(t.recipes)
        .values({
          tenantId: principal.tenantId,
          itemId: current.itemId,
          versionNo: current.versionNo + 1,
          validFrom: now,
          yieldFactor: current.yieldFactor,
          outputQuantity: current.outputQuantity,
          outputUnit: current.outputUnit,
          portions: current.portions,
          listPriceCents: current.listPriceCents,
          method: current.method,
          createdByUserId: principal.userId,
        })
        .returning();
      if (!next) throw new Error('No se pudo abrir la version nueva');

      await this.replaceLines(
        tx,
        principal.tenantId,
        next.id,
        current.lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unit: line.unit,
          cleaningYieldOverride: line.cleaningYieldOverride,
          note: line.note,
        })),
      );
      await recordAuditFor(tx, principal, 'CREATE', 'recipe', next.id, {
        from: id,
        versionNo: next.versionNo,
      });
      return this.loadRecipe(tx, next.id);
    });
  }

  // --- Internos ------------------------------------------------------------------

  private canReadCost(principal: Principal): boolean {
    try {
      assertPermission(principal, 'cost:read');
      return true;
    } catch {
      return false;
    }
  }

  private async targetFoodCost(tx: Database): Promise<string> {
    const [row] = await tx.select({ target: t.tenants.targetFoodCost }).from(t.tenants).limit(1);
    return row?.target ?? '0.30';
  }

  private async replaceLines(
    tx: Database,
    tenantId: string,
    recipeId: string,
    lines: NonNullable<CreateRecipeDto['lines']>,
  ): Promise<void> {
    await tx.delete(t.recipeLines).where(eq(t.recipeLines.recipeId, recipeId));
    if (lines.length === 0) return;

    // Se valida aqui, antes de escribir, para que el mensaje de error hable de
    // la linea concreta y no de un `numeric` fuera de rango.
    lines.forEach((line, index) => {
      Quantity.of(line.quantity, line.unit);
      if (line.cleaningYieldOverride) {
        const value = new Decimal(line.cleaningYieldOverride);
        if (!value.greaterThan(0) || value.greaterThan(1)) {
          throw new ConflictException({
            code: 'INVALID_YIELD',
            message: `La merma de la linea ${index + 1} debe estar entre 0 y 1.`,
          });
        }
      }
    });

    await tx.insert(t.recipeLines).values(
      lines.map((line, index) => ({
        tenantId,
        recipeId,
        itemId: line.itemId,
        quantity: line.quantity,
        unit: line.unit,
        cleaningYieldOverride: line.cleaningYieldOverride,
        note: line.note,
        sortOrder: index,
      })),
    );
  }

  /**
   * Segunda comprobacion de ciclos, sobre el estado ya escrito.
   *
   * El disparador de la base de datos ya rechaza el ciclo, pero su mensaje es
   * el de una violacion de restriccion. Esta comprobacion devuelve la ruta
   * completa -- salsa -> fondo -> salsa -- que es lo unico que sirve para
   * arreglarlo.
   */
  private async assertNoCycle(tx: Database, itemId: string): Promise<void> {
    const { recipes } = await this.costing.loadDomainState(tx);
    const cycle = findCycle(recipes, [itemId]);
    if (cycle) {
      throw new ConflictException({
        code: 'CYCLIC_RECIPE',
        message: `Ciclo en las elaboraciones anidadas: ${cycle.join(' -> ')}.`,
        details: { cycle },
      });
    }
  }

  private async loadRecipe(tx: Database, id: string): Promise<RecipeDto> {
    const row = await tx.query.recipes.findFirst({
      where: eq(t.recipes.id, id),
      with: {
        lines: { orderBy: (lines, { asc: ascending }) => [ascending(lines.sortOrder)] },
        item: true,
      },
    });
    if (!row) {
      throw new NotFoundException({ code: 'UNKNOWN_RECIPE', message: 'La receta no existe.' });
    }

    const lineItemIds = row.lines.map((line) => line.itemId);
    const lineItems = lineItemIds.length
      ? await tx.select().from(t.items).where(inArray(t.items.id, lineItemIds))
      : [];
    const itemById = new Map(lineItems.map((item) => [item.id, item]));

    const preparationIds = new Set(
      (
        await tx
          .select({ itemId: t.recipes.itemId })
          .from(t.recipes)
          .where(isNull(t.recipes.validTo))
      ).map((r) => r.itemId),
    );

    return {
      id: row.id,
      itemId: row.itemId,
      itemName: row.item.name,
      versionNo: row.versionNo,
      validFrom: row.validFrom.toISOString(),
      validTo: row.validTo?.toISOString() ?? null,
      yieldFactor: row.yieldFactor,
      outputQuantity: row.outputQuantity,
      outputUnit: row.outputUnit,
      portions: row.portions,
      listPriceCents: row.listPriceCents,
      method: row.method,
      lines: row.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemName: itemById.get(line.itemId)?.name ?? line.itemId,
        itemIsPreparation: preparationIds.has(line.itemId),
        quantity: line.quantity,
        unit: line.unit,
        cleaningYieldOverride: line.cleaningYieldOverride,
        note: line.note,
        sortOrder: line.sortOrder,
      })),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Ultimo valor congelado de un escandallo, por receta. */
function latestSnapshot(column: string) {
  return sql<string | null>`(
    select cs.${sql.raw(column)} from cost_snapshot cs
    where cs.recipe_id = ${t.recipes.id}
    order by cs.calculated_at desc
    limit 1
  )`;
}

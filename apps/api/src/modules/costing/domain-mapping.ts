import {
  Decimal,
  Quantity,
  Money,
  type AllergenPresence,
  type Catalog,
  type CatalogItem,
  type ItemKind,
  type RecipeBook,
  type RecipeNode,
  type Unit,
} from '@warekai/domain';

/**
 * Puente entre las filas de la base de datos y el motor de costes.
 *
 * Aqui se cruza la unica frontera que importa: los `numeric` de Postgres
 * llegan como **cadena** y se convierten a `Decimal` directamente, sin pasar
 * por `Number` en ningun punto. Si alguien mete un `parseFloat` en este
 * fichero, el escandallo deja de ser exacto y nadie se entera hasta que
 * cuadran el margen a fin de mes.
 */

export interface ItemRowForDomain {
  id: string;
  name: string;
  kinds: ItemKind[];
  purchaseUnitLabel: string;
  stockUnitLabel: string;
  usageUnit: Unit;
  purchaseToStock: string;
  stockToUsage: string;
  densityGPerMl: string | null;
  weightPerPieceG: string | null;
  purchasePriceCents: number | null;
  cleaningYield: string;
  vatRate: string;
  allergens: AllergenPresence[];
}

export interface RecipeLineRowForDomain {
  itemId: string;
  quantity: string;
  unit: Unit;
  cleaningYieldOverride: string | null;
}

export interface RecipeRowForDomain {
  itemId: string;
  yieldFactor: string;
  outputQuantity: string;
  outputUnit: Unit;
  portions: number;
  lines: RecipeLineRowForDomain[];
}

export function toCatalogItem(row: ItemRowForDomain): CatalogItem {
  return {
    id: row.id,
    name: row.name,
    kinds: row.kinds,
    units: {
      purchaseUnitLabel: row.purchaseUnitLabel,
      stockUnitLabel: row.stockUnitLabel,
      usageUnit: row.usageUnit,
      purchaseToStock: new Decimal(row.purchaseToStock),
      stockToUsage: new Decimal(row.stockToUsage),
      ...(row.densityGPerMl ? { densityGPerMl: new Decimal(row.densityGPerMl) } : {}),
      ...(row.weightPerPieceG ? { weightPerPieceG: new Decimal(row.weightPerPieceG) } : {}),
    },
    ...(row.purchasePriceCents === null
      ? {}
      : { purchasePrice: Money.fromCents(row.purchasePriceCents) }),
    cleaningYield: new Decimal(row.cleaningYield),
    allergens: row.allergens,
    vatRate: new Decimal(row.vatRate),
  };
}

export function toCatalog(rows: readonly ItemRowForDomain[]): Catalog {
  return new Map(rows.map((row) => [row.id, toCatalogItem(row)]));
}

export function toRecipeNode(row: RecipeRowForDomain): RecipeNode {
  return {
    itemId: row.itemId,
    yieldFactor: new Decimal(row.yieldFactor),
    outputQuantity: Quantity.of(row.outputQuantity, row.outputUnit),
    portions: row.portions,
    lines: row.lines.map((line) => ({
      itemId: line.itemId,
      quantity: Quantity.of(line.quantity, line.unit),
      ...(line.cleaningYieldOverride
        ? { cleaningYieldOverride: new Decimal(line.cleaningYieldOverride) }
        : {}),
    })),
  };
}

export function toRecipeBook(rows: readonly RecipeRowForDomain[]): RecipeBook {
  return new Map(rows.map((row) => [row.itemId, toRecipeNode(row)]));
}

import { Decimal } from '../decimal.js';
import { Money } from '../money.js';
import type {
  AllergenPresence,
  Catalog,
  CatalogItem,
  ItemKind,
  ItemUnits,
  RecipeBook,
  RecipeNode,
} from '../types.js';
import { Quantity, type Unit } from '../units.js';

/**
 * Cocina de laboratorio con numeros elegidos a mano para poder verificar cada
 * escandallo con lapiz y papel. Los factores de correccion son los reales.
 */

interface ItemSpec {
  id: string;
  name: string;
  kinds?: ItemKind[];
  purchaseUnitLabel?: string;
  stockUnitLabel?: string;
  usageUnit: Unit;
  purchaseToStock?: string;
  stockToUsage: string;
  priceCents?: number;
  cleaningYield?: string;
  densityGPerMl?: string;
  weightPerPieceG?: string;
  allergens?: AllergenPresence[];
  vatRate?: string;
}

export function item(spec: ItemSpec): CatalogItem {
  const units: ItemUnits = {
    purchaseUnitLabel: spec.purchaseUnitLabel ?? 'caja',
    stockUnitLabel: spec.stockUnitLabel ?? 'unidad',
    usageUnit: spec.usageUnit,
    purchaseToStock: new Decimal(spec.purchaseToStock ?? '1'),
    stockToUsage: new Decimal(spec.stockToUsage),
    ...(spec.densityGPerMl ? { densityGPerMl: new Decimal(spec.densityGPerMl) } : {}),
    ...(spec.weightPerPieceG ? { weightPerPieceG: new Decimal(spec.weightPerPieceG) } : {}),
  };
  return {
    id: spec.id,
    name: spec.name,
    kinds: spec.kinds ?? ['RAW'],
    units,
    ...(spec.priceCents === undefined ? {} : { purchasePrice: Money.fromCents(spec.priceCents) }),
    cleaningYield: new Decimal(spec.cleaningYield ?? '1'),
    allergens: spec.allergens ?? [],
    vatRate: new Decimal(spec.vatRate ?? '0.10'),
  };
}

export function catalogOf(items: readonly CatalogItem[]): Catalog {
  return new Map(items.map((i) => [i.id, i]));
}

export function recipesOf(nodes: readonly RecipeNode[]): RecipeBook {
  return new Map(nodes.map((n) => [n.itemId, n]));
}

export const q = (amount: string, unit: Unit): Quantity => Quantity.of(amount, unit);
export const d = (value: string): Decimal => new Decimal(value);

// --- Materias primas ---------------------------------------------------------

/** Caja de 5 kg a 20,00 EUR -> 0,4 centimos/g. Rendimiento real del 40 %. */
export const ALCACHOFA = item({
  id: 'alcachofa',
  name: 'Alcachofa',
  usageUnit: 'g',
  purchaseUnitLabel: 'caja',
  stockUnitLabel: 'kg',
  purchaseToStock: '5',
  stockToUsage: '1000',
  priceCents: 2000,
  cleaningYield: '0.4',
});

/** Caja de 6 botellas de 700 ml a 42,00 EUR -> 1 centimo/ml. */
export const ACEITE = item({
  id: 'aceite',
  name: 'Aceite de oliva virgen extra',
  usageUnit: 'ml',
  purchaseUnitLabel: 'caja',
  stockUnitLabel: 'botella',
  purchaseToStock: '6',
  stockToUsage: '700',
  priceCents: 4200,
  densityGPerMl: '0.916',
});

/** Saco de 10 kg a 8,00 EUR -> 0,08 centimos/g. Pieza media de 150 g. */
export const CEBOLLA = item({
  id: 'cebolla',
  name: 'Cebolla',
  usageUnit: 'g',
  purchaseUnitLabel: 'saco',
  stockUnitLabel: 'saco',
  stockToUsage: '10000',
  priceCents: 800,
  cleaningYield: '0.9',
  weightPerPieceG: '150',
});

/** Lleva apio: sirve para comprobar la propagacion desde el fondo del grafo. */
export const APIO = item({
  id: 'apio',
  name: 'Apio',
  usageUnit: 'g',
  stockToUsage: '1000',
  priceCents: 250,
  cleaningYield: '0.8',
  allergens: [{ code: 'APIO', level: 'CONTAINS' }],
});

export const NATA = item({
  id: 'nata',
  name: 'Nata 35 % MG',
  usageUnit: 'ml',
  stockToUsage: '1000',
  priceCents: 350,
  densityGPerMl: '1.02',
  allergens: [{ code: 'LACTEOS', level: 'CONTAINS' }],
});

// --- Elaboraciones -----------------------------------------------------------

/** Item que representa la salsa. Se costea en ml, la unidad de su receta. */
export const SALSA_ITEM = item({
  id: 'salsa_alcachofa',
  name: 'Salsa de alcachofa',
  kinds: ['PREP'],
  usageUnit: 'ml',
  stockToUsage: '1000',
});

export const PLATO_ITEM = item({
  id: 'plato_alcachofas',
  name: 'Alcachofas confitadas con su salsa',
  kinds: ['SALE'],
  usageUnit: 'ud',
  stockToUsage: '1',
});

/**
 * 400 g netos de alcachofa (= 1000 g de compra) + 100 ml de aceite.
 * Coste de entradas 5,00 EUR. Reduce al 40 %: de 1000 ml salen 400 ml.
 * -> 1,25 centimos/ml.
 */
export const SALSA: RecipeNode = {
  itemId: 'salsa_alcachofa',
  lines: [
    { itemId: 'alcachofa', quantity: q('400', 'g') },
    { itemId: 'aceite', quantity: q('100', 'ml') },
  ],
  yieldFactor: d('0.4'),
  outputQuantity: q('1000', 'ml'),
  portions: 4,
};

/**
 * El plato del enunciado: alcachofa al 40 % dentro de una salsa reducida,
 * dentro de un plato de tres raciones.
 */
export const PLATO: RecipeNode = {
  itemId: 'plato_alcachofas',
  lines: [
    { itemId: 'salsa_alcachofa', quantity: q('200', 'ml') },
    { itemId: 'cebolla', quantity: q('100', 'g') },
  ],
  yieldFactor: d('1'),
  outputQuantity: q('3', 'ud'),
  portions: 3,
};

export const BASIC_CATALOG = catalogOf([
  ALCACHOFA,
  ACEITE,
  CEBOLLA,
  APIO,
  NATA,
  SALSA_ITEM,
  PLATO_ITEM,
]);

export const BASIC_RECIPES = recipesOf([SALSA, PLATO]);

import { type Decimal, HUNDRED, ONE } from './decimal.js';
import {
  assertRecipeNode,
  buildUnitCostIndex,
  explodeRecipe,
  requireItem,
  requireRecipe,
  type ExplodedLine,
  type UnitCostIndex,
} from './explode.js';
import { Money } from './money.js';
import type { Catalog, RecipeBook } from './types.js';
import { type Quantity } from './units.js';
import { netOutput } from './yield.js';

export interface CostBreakdown {
  readonly itemId: string;
  readonly itemName: string;
  /** Coste de los ingredientes del lote completo. */
  readonly totalCost: Money;
  readonly portions: number;
  readonly costPerPortion: Money;
  /** Produccion real del lote, ya aplicada la merma de proceso. */
  readonly netOutput: Quantity;
  /** Coste de una unidad de salida (un ml de fondo, un g de sofrito). */
  readonly costPerOutputUnit: Money;
  /** Escandallo explotado en preorden; `depth === 0` son las lineas directas. */
  readonly lines: readonly ExplodedLine[];
}

/**
 * Escandallo completo de una receta.
 *
 * El coste total no se ve afectado por la merma de proceso -- reducir un fondo
 * no gasta mas producto -- pero el coste por unidad de salida si, porque el
 * mismo dinero se reparte entre menos producto.
 *
 * @throws {CyclicRecipeError} si las elaboraciones anidadas forman un ciclo.
 */
export function calculateRecipeCost(
  rootItemId: string,
  catalog: Catalog,
  recipes: RecipeBook,
  index: UnitCostIndex = buildUnitCostIndex(catalog, recipes, [rootItemId]),
): CostBreakdown {
  const node = assertRecipeNode(requireRecipe(recipes, rootItemId));
  const item = requireItem(catalog, rootItemId);
  const lines = explodeRecipe(rootItemId, catalog, recipes, index);

  const totalCost = Money.sum(lines.filter((l) => l.depth === 0).map((l) => l.lineCost));
  const output = netOutput(node.outputQuantity, node.yieldFactor);

  return {
    itemId: rootItemId,
    itemName: item.name,
    totalCost,
    portions: node.portions,
    costPerPortion: totalCost.dividedBy(node.portions, 'el coste por racion'),
    netOutput: output,
    costPerOutputUnit: totalCost.dividedBy(output.amount, 'el coste por unidad de salida'),
    lines,
  };
}

/** Food cost como fraccion: 0,28 es un 28 %. Siempre sobre PVP **sin IVA**. */
export function foodCostRatio(cost: Money, netPrice: Money): Decimal {
  return cost.ratioTo(netPrice, 'el food cost');
}

/** Food cost en porcentaje: 28 para un 28 %. */
export function foodCostPercentage(cost: Money, netPrice: Money): Decimal {
  return foodCostRatio(cost, netPrice).times(HUNDRED);
}

/** Margen bruto en dinero: PVP sin IVA menos coste. */
export function grossMargin(cost: Money, netPrice: Money): Money {
  return netPrice.minus(cost);
}

/** Margen bruto en porcentaje sobre el PVP sin IVA. Complementario del food cost. */
export function grossMarginPercentage(cost: Money, netPrice: Money): Decimal {
  return ONE.minus(foodCostRatio(cost, netPrice)).times(HUNDRED);
}

/** Quita el IVA de un precio de carta. */
export function netPriceFromGross(grossPrice: Money, vatRate: Decimal): Money {
  return grossPrice.dividedBy(ONE.plus(vatRate), 'el precio sin IVA');
}

/** Anade el IVA a un precio neto. */
export function grossPriceFromNet(netPrice: Money, vatRate: Decimal): Money {
  return netPrice.times(ONE.plus(vatRate));
}

import { type Decimal, ONE } from './decimal.js';
import { convert, costPerUsageUnit } from './conversion.js';
import {
  InvalidValueError,
  MissingPurchasePriceError,
  UnknownItemError,
  UnknownRecipeError,
} from './errors.js';
import { topologicalOrder } from './graph.js';
import { Money } from './money.js';
import type { Catalog, CatalogItem, RecipeBook, RecipeLineInput, RecipeNode } from './types.js';
import { type Quantity, type Unit } from './units.js';
import { assertYieldFactor, grossFromNet, netOutput, outputCostPerUnit } from './yield.js';

/** Coste de una unidad del item, expresado en la unidad en la que se costea. */
export interface UnitCost {
  readonly cost: Money;
  readonly unit: Unit;
}

/** Indice de costes unitarios por item, con precision decimal completa. */
export type UnitCostIndex = ReadonlyMap<string, UnitCost>;

/** Una linea del escandallo explotado, ya referida al lote de la receta raiz. */
export interface ExplodedLine {
  readonly itemId: string;
  readonly itemName: string;
  /** Ruta de items desde la primera linea de la raiz hasta este, ambos incluidos. */
  readonly path: readonly string[];
  /** 0 para una linea directa de la receta raiz. */
  readonly depth: number;
  readonly isPreparation: boolean;
  /** Cantidad neta, tal como se declara en la receta, escalada al lote raiz. */
  readonly netQuantity: Quantity;
  /** Cantidad bruta tras deshacer la merma de limpieza, en la unidad de coste. */
  readonly grossQuantity: Quantity;
  readonly cleaningYield: Decimal;
  readonly unitCost: Money;
  readonly lineCost: Money;
}

export function requireItem(catalog: Catalog, itemId: string): CatalogItem {
  const item = catalog.get(itemId);
  if (!item) {
    throw new UnknownItemError(itemId);
  }
  return item;
}

export function requireRecipe(recipes: RecipeBook, itemId: string): RecipeNode {
  const node = recipes.get(itemId);
  if (!node) {
    throw new UnknownRecipeError(itemId);
  }
  return node;
}

/** Valida los invariantes de una receta antes de costearla. */
export function assertRecipeNode(node: RecipeNode): RecipeNode {
  assertYieldFactor(node.yieldFactor, 'proceso');
  if (!node.outputQuantity.amount.greaterThan(0)) {
    throw new InvalidValueError(
      `cantidad de salida de ${node.itemId}`,
      node.outputQuantity.toString(),
      'una cantidad mayor que cero',
    );
  }
  if (!Number.isInteger(node.portions) || node.portions <= 0) {
    throw new InvalidValueError(
      `raciones de ${node.itemId}`,
      String(node.portions),
      'un numero entero mayor que cero',
    );
  }
  return node;
}

/** Unidad en la que se costea un item: la de salida si es elaboracion, la de uso si no. */
export function costingUnitOf(item: CatalogItem, recipes: RecipeBook): Unit {
  const node = recipes.get(item.id);
  return node ? node.outputQuantity.unit : item.units.usageUnit;
}

function rawUnitCost(item: CatalogItem): UnitCost {
  if (!item.purchasePrice) {
    throw new MissingPurchasePriceError(item.id);
  }
  return {
    cost: costPerUsageUnit(item.purchasePrice, item.units),
    unit: item.units.usageUnit,
  };
}

interface LineComputation {
  readonly item: CatalogItem;
  readonly cleaningYield: Decimal;
  readonly netQuantity: Quantity;
  readonly grossQuantity: Quantity;
  readonly unitCost: Money;
  readonly lineCost: Money;
}

/**
 * Resuelve una linea de receta: aplica la merma de limpieza, convierte a la
 * unidad de coste del item y multiplica por su coste unitario.
 *
 * `scale` permite referir la linea al lote de una receta superior cuando la
 * elaboracion se consume solo en parte.
 */
function computeLine(
  line: RecipeLineInput,
  catalog: Catalog,
  index: UnitCostIndex,
  costingUnit: Unit,
  scale: Decimal,
): LineComputation {
  const item = requireItem(catalog, line.itemId);
  const cleaningYield = assertYieldFactor(
    line.cleaningYieldOverride ?? item.cleaningYield,
    'limpieza',
  );

  const netQuantity = line.quantity.times(scale);
  const grossInLineUnit = grossFromNet(netQuantity, cleaningYield);
  const grossQuantity = convert(grossInLineUnit, costingUnit, item.units, item.id);

  // Si el indice no cubre el item es porque es una hoja fuera del subgrafo
  // recorrido; se costea al vuelo por su precio de compra.
  const unitCost = (index.get(item.id) ?? rawUnitCost(item)).cost;
  return {
    item,
    cleaningYield,
    netQuantity,
    grossQuantity,
    unitCost,
    lineCost: unitCost.times(grossQuantity.amount),
  };
}

/**
 * Calcula el coste unitario de cada item alcanzable desde `roots`, en orden
 * topologico: cuando le toca el turno a una elaboracion, todos sus insumos ya
 * tienen coste resuelto, asi que cada nodo se visita una sola vez.
 *
 * @throws {CyclicRecipeError} si el grafo tiene ciclos.
 */
export function buildUnitCostIndex(
  catalog: Catalog,
  recipes: RecipeBook,
  roots?: readonly string[],
): UnitCostIndex {
  const index = new Map<string, UnitCost>();
  const order = topologicalOrder(recipes, roots);

  for (const recipeItemId of order) {
    const node = assertRecipeNode(recipes.get(recipeItemId) as RecipeNode);
    let inputCost = Money.zero();

    for (const line of node.lines) {
      const item = requireItem(catalog, line.itemId);
      if (!index.has(item.id)) {
        // No esta en el indice y el orden topologico ya paso: es una hoja,
        // es decir una materia prima que se costea por su precio de compra.
        index.set(item.id, rawUnitCost(item));
      }
      const costingUnit = costingUnitOf(item, recipes);
      inputCost = inputCost.plus(computeLine(line, catalog, index, costingUnit, ONE).lineCost);
    }

    requireItem(catalog, recipeItemId);
    index.set(recipeItemId, {
      cost: outputCostPerUnit(inputCost, node.outputQuantity, node.yieldFactor),
      unit: node.outputQuantity.unit,
    });
  }

  return index;
}

/**
 * Explosion recursiva de una receta, sin limite de profundidad.
 *
 * Devuelve la lista completa en preorden: cada elaboracion intermedia aparece
 * como linea propia y, a continuacion, sus componentes con `depth` mayor. Las
 * cantidades y los costes de los niveles inferiores vienen ya escalados a la
 * fraccion del lote que realmente se consume, de modo que la suma de las
 * lineas hijas de una elaboracion es exactamente el coste de su linea padre.
 *
 * Sumar unicamente las lineas de `depth === 0` da el coste total de la receta.
 */
export function explodeRecipe(
  rootItemId: string,
  catalog: Catalog,
  recipes: RecipeBook,
  index: UnitCostIndex = buildUnitCostIndex(catalog, recipes, [rootItemId]),
): ExplodedLine[] {
  requireRecipe(recipes, rootItemId);
  const lines: ExplodedLine[] = [];

  const walk = (itemId: string, scale: Decimal, path: readonly string[]): void => {
    const node = assertRecipeNode(recipes.get(itemId) as RecipeNode);

    for (const line of node.lines) {
      const item = requireItem(catalog, line.itemId);
      const isPreparation = recipes.has(item.id);
      const costingUnit = costingUnitOf(item, recipes);
      const computed = computeLine(line, catalog, index, costingUnit, scale);
      const childPath = [...path, item.id];

      lines.push({
        itemId: item.id,
        itemName: item.name,
        path: childPath,
        depth: childPath.length - 1,
        isPreparation,
        netQuantity: computed.netQuantity,
        grossQuantity: computed.grossQuantity,
        cleaningYield: computed.cleaningYield,
        unitCost: computed.unitCost,
        lineCost: computed.lineCost,
      });

      if (isPreparation) {
        // Fraccion del lote de la elaboracion hija que consume esta linea.
        const childNode = recipes.get(item.id) as RecipeNode;
        const childOutput = netOutput(childNode.outputQuantity, childNode.yieldFactor);
        walk(item.id, computed.grossQuantity.ratioTo(childOutput), childPath);
      }
    }
  };

  walk(rootItemId, ONE, []);
  return lines;
}

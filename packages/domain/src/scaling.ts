import { Decimal } from './decimal.js';
import { assertRecipeNode } from './explode.js';
import { InvalidValueError } from './errors.js';
import type { RecipeNode } from './types.js';
import { type Quantity } from './units.js';

/**
 * Escala una receta a un numero arbitrario de raciones.
 *
 * Se escalan las cantidades de las lineas y la produccion del lote. **No** se
 * tocan los factores de merma: el rendimiento de una alcachofa no depende de
 * cuantas se limpien, y el de una reduccion tampoco de cuanto fondo haya en la
 * olla. Suponer lo contrario es el error clasico al doblar un escandallo.
 */
export function scaleRecipe(node: RecipeNode, targetPortions: number): RecipeNode {
  assertRecipeNode(node);
  if (!Number.isInteger(targetPortions) || targetPortions <= 0) {
    throw new InvalidValueError(
      'raciones objetivo',
      String(targetPortions),
      'un numero entero mayor que cero',
    );
  }
  return scaleBy(node, new Decimal(targetPortions), new Decimal(node.portions), targetPortions);
}

/**
 * Escala una receta para obtener una cantidad de salida concreta.
 * Util cuando la produccion se planifica por litros de fondo, no por raciones.
 */
export function scaleRecipeToOutput(node: RecipeNode, targetOutput: Quantity): RecipeNode {
  assertRecipeNode(node);
  if (targetOutput.unit !== node.outputQuantity.unit) {
    throw new InvalidValueError(
      'unidad de salida objetivo',
      targetOutput.unit,
      `la misma unidad que la salida de la receta (${node.outputQuantity.unit})`,
    );
  }
  if (!targetOutput.amount.greaterThan(0)) {
    throw new InvalidValueError(
      'cantidad de salida objetivo',
      targetOutput.toString(),
      'una cantidad mayor que cero',
    );
  }
  return scaleBy(node, targetOutput.amount, node.outputQuantity.amount, node.portions);
}

/**
 * El factor se aplica como fraccion (multiplicar y luego dividir) en vez de
 * precalcularlo. Escalar un lote de 3 raciones a 1 racion y volver a 3 debe
 * devolver exactamente 3, y no 2,999...9: con un factor precalculado de 1/3 el
 * redondeo de la division se arrastra a cada linea.
 */
function scaleBy(
  node: RecipeNode,
  numerator: Decimal,
  denominator: Decimal,
  portions: number,
): RecipeNode {
  const apply = (quantity: Quantity): Quantity => quantity.times(numerator).dividedBy(denominator);
  return {
    ...node,
    portions,
    outputQuantity: apply(node.outputQuantity),
    lines: node.lines.map((line) => ({ ...line, quantity: apply(line.quantity) })),
  };
}

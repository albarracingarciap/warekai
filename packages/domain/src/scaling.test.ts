import { describe, expect, it } from 'vitest';
import { calculateRecipeCost } from './costing.js';
import { InvalidValueError } from './errors.js';
import { scaleRecipe, scaleRecipeToOutput } from './scaling.js';
import { Quantity } from './units.js';
import { BASIC_CATALOG, PLATO, SALSA, d, q, recipesOf } from './__fixtures__/kitchen.js';

describe('escalado por raciones', () => {
  it('multiplica cantidades y produccion, no las mermas', () => {
    const doble = scaleRecipe(PLATO, 6);
    expect(doble.portions).toBe(6);
    expect(doble.outputQuantity.toString()).toBe('6 ud');
    expect(doble.lines.map((l) => l.quantity.toString())).toEqual(['400 ml', '200 g']);
    expect(doble.yieldFactor.toString()).toBe(PLATO.yieldFactor.toString());
  });

  it('escala a la baja con fracciones exactas', () => {
    const una = scaleRecipe(PLATO, 1);
    expect(una.lines[0]!.quantity.amount.toFixed(6)).toBe('66.666667');
    expect(una.outputQuantity.toString()).toBe('1 ud');
  });

  it('el coste por racion no cambia al escalar', () => {
    const original = calculateRecipeCost(
      'plato_alcachofas',
      BASIC_CATALOG,
      recipesOf([SALSA, PLATO]),
    );
    const escalado = calculateRecipeCost(
      'plato_alcachofas',
      BASIC_CATALOG,
      recipesOf([SALSA, scaleRecipe(PLATO, 30)]),
    );
    expect(escalado.portions).toBe(30);
    expect(escalado.costPerPortion.exactCents.toFixed(6)).toBe(
      original.costPerPortion.exactCents.toFixed(6),
    );
    expect(escalado.totalCost.exactCents.toFixed(4)).toBe(
      original.totalCost.times(10).exactCents.toFixed(4),
    );
  });

  it('conserva las anotaciones de la linea', () => {
    const conNota = scaleRecipe(
      { ...PLATO, lines: [{ itemId: 'cebolla', quantity: q('100', 'g'), note: 'en brunoise' }] },
      6,
    );
    expect(conNota.lines[0]!.note).toBe('en brunoise');
  });

  it('rechaza raciones que no sean enteros positivos', () => {
    expect(() => scaleRecipe(PLATO, 0)).toThrow(InvalidValueError);
    expect(() => scaleRecipe(PLATO, -3)).toThrow(InvalidValueError);
    expect(() => scaleRecipe(PLATO, 2.5)).toThrow(/raciones objetivo/);
  });

  it('valida la receta de partida', () => {
    expect(() => scaleRecipe({ ...PLATO, portions: 0 }, 4)).toThrow(InvalidValueError);
  });
});

describe('escalado por cantidad de salida', () => {
  it('produce el volumen de fondo pedido', () => {
    // La salsa parte de 1000 ml; para 2500 ml se multiplica por 2,5.
    const escalada = scaleRecipeToOutput(SALSA, Quantity.of('2500', 'ml'));
    expect(escalada.outputQuantity.toString()).toBe('2500 ml');
    expect(escalada.lines.map((l) => l.quantity.toString())).toEqual(['1000 g', '250 ml']);
    expect(escalada.portions).toBe(SALSA.portions);
  });

  it('no toca el rendimiento: reducir mas cantidad no reduce distinto', () => {
    expect(scaleRecipeToOutput(SALSA, Quantity.of('5000', 'ml')).yieldFactor.toString()).toBe(
      '0.4',
    );
  });

  it('exige la misma unidad de salida', () => {
    expect(() => scaleRecipeToOutput(SALSA, Quantity.of('2.5', 'l'))).toThrow(
      /misma unidad que la salida/,
    );
  });

  it('rechaza una salida objetivo nula', () => {
    expect(() => scaleRecipeToOutput(SALSA, Quantity.zero('ml'))).toThrow(InvalidValueError);
  });

  it('valida la receta de partida', () => {
    expect(() =>
      scaleRecipeToOutput({ ...SALSA, yieldFactor: d('2') }, Quantity.of('100', 'ml')),
    ).toThrow(/merma de proceso/);
  });
});

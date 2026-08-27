import { describe, expect, it } from 'vitest';
import { propagateAllergens, propagateRecipeAllergens } from './allergens.js';
import { UnknownItemError, UnknownRecipeError } from './errors.js';
import type { RecipeNode } from './types.js';
import { APIO, NATA, catalogOf, d, item, q, recipesOf } from './__fixtures__/kitchen.js';

const HARINA = item({
  id: 'harina',
  name: 'Harina de trigo',
  usageUnit: 'g',
  stockToUsage: '1000',
  priceCents: 90,
  allergens: [{ code: 'GLUTEN', level: 'CONTAINS' }],
});

/** Especias envasadas en una linea que tambien manipula frutos secos. */
const PIMENTON = item({
  id: 'pimenton',
  name: 'Pimenton de la Vera',
  usageUnit: 'g',
  stockToUsage: '1000',
  priceCents: 600,
  allergens: [
    { code: 'FRUTOS_DE_CASCARA', level: 'TRACES' },
    { code: 'GLUTEN', level: 'TRACES' },
  ],
});

/**
 * El propio item de la elaboracion declara trazas de gluten: es donde se anota
 * lo que introduce el proceso y no un ingrediente concreto -- aqui, una freidora
 * compartida.
 */
const FONDO_ITEM = item({
  id: 'fondo',
  name: 'Fondo oscuro',
  kinds: ['PREP'],
  usageUnit: 'ml',
  stockToUsage: '1000',
  allergens: [{ code: 'GLUTEN', level: 'TRACES' }],
});
const SALSA_ITEM = item({
  id: 'salsa',
  name: 'Salsa',
  kinds: ['PREP'],
  usageUnit: 'ml',
  stockToUsage: '1000',
});
const PLATO_ITEM = item({
  id: 'plato',
  name: 'Plato',
  kinds: ['SALE'],
  usageUnit: 'ud',
  stockToUsage: '1',
});

const prep = (itemId: string, componentIds: string[]): RecipeNode => ({
  itemId,
  lines: componentIds.map((id) => ({ itemId: id, quantity: q('100', 'ml') })),
  yieldFactor: d('0.5'),
  outputQuantity: q('200', 'ml'),
  portions: 1,
});

const CATALOG = catalogOf([APIO, NATA, HARINA, PIMENTON, FONDO_ITEM, SALSA_ITEM, PLATO_ITEM]);

// plato -> salsa -> fondo -> apio.  El apio esta tres niveles por debajo.
const RECIPES = recipesOf([
  prep('plato', ['salsa', 'harina']),
  prep('salsa', ['fondo', 'nata']),
  prep('fondo', ['apio', 'pimenton']),
]);

describe('propagacion de alergenos hacia arriba', () => {
  it('el apio del fondo llega al plato tres niveles mas arriba', () => {
    const allergens = propagateAllergens('plato', CATALOG, RECIPES);
    expect(allergens.find((a) => a.code === 'APIO')).toEqual({
      code: 'APIO',
      level: 'CONTAINS',
    });
  });

  it('recoge todos los alergenos del arbol, ordenados', () => {
    expect(propagateAllergens('plato', CATALOG, RECIPES)).toEqual([
      { code: 'APIO', level: 'CONTAINS' },
      { code: 'FRUTOS_DE_CASCARA', level: 'TRACES' },
      { code: 'GLUTEN', level: 'CONTAINS' },
      { code: 'LACTEOS', level: 'CONTAINS' },
    ]);
  });

  it('CONTAINS gana sobre TRACES al unir ramas', () => {
    // El fondo y el pimenton aportan trazas de gluten; la harina lo contiene.
    const soloTrazas = propagateAllergens('fondo', CATALOG, RECIPES);
    expect(soloTrazas.find((a) => a.code === 'GLUTEN')?.level).toBe('TRACES');
    const conHarina = propagateAllergens('plato', CATALOG, RECIPES);
    expect(conHarina.find((a) => a.code === 'GLUTEN')?.level).toBe('CONTAINS');
  });

  it('el orden de las ramas no altera el resultado', () => {
    const invertido = recipesOf([
      prep('plato', ['harina', 'salsa']),
      prep('salsa', ['fondo', 'nata']),
      prep('fondo', ['pimenton', 'apio']),
    ]);
    expect(propagateAllergens('plato', CATALOG, invertido)).toEqual(
      propagateAllergens('plato', CATALOG, RECIPES),
    );
  });

  it('mantiene TRACES cuando nadie aporta CONTAINS', () => {
    expect(propagateAllergens('pimenton', CATALOG, RECIPES)).toEqual([
      { code: 'FRUTOS_DE_CASCARA', level: 'TRACES' },
      { code: 'GLUTEN', level: 'TRACES' },
    ]);
  });

  it('no se pierde en un diamante ni duplica alergenos', () => {
    const diamante = recipesOf([
      prep('plato', ['salsa', 'fondo']),
      prep('salsa', ['fondo']),
      prep('fondo', ['apio']),
    ]);
    expect(propagateAllergens('plato', CATALOG, diamante)).toEqual([
      { code: 'APIO', level: 'CONTAINS' },
      { code: 'GLUTEN', level: 'TRACES' },
    ]);
  });

  it('una materia prima sin alergenos devuelve lista vacia', () => {
    const sinNada = item({ id: 'agua', name: 'Agua', usageUnit: 'ml', stockToUsage: '1000' });
    expect(propagateAllergens('agua', catalogOf([sinNada]), recipesOf([]))).toEqual([]);
  });

  it('exige que el item exista', () => {
    expect(() => propagateAllergens('fantasma', CATALOG, RECIPES)).toThrow(UnknownItemError);
  });
});

describe('propagacion sobre una ficha tecnica', () => {
  it('exige que la raiz sea una receta', () => {
    expect(() => propagateRecipeAllergens('apio', CATALOG, RECIPES)).toThrow(UnknownRecipeError);
  });

  it('devuelve lo mismo que la version general', () => {
    expect(propagateRecipeAllergens('plato', CATALOG, RECIPES)).toEqual(
      propagateAllergens('plato', CATALOG, RECIPES),
    );
  });
});

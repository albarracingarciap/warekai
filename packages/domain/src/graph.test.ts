import { describe, expect, it } from 'vitest';
import { CyclicRecipeError } from './errors.js';
import { dependenciesOf, dependentsOf, findCycle, topologicalOrder } from './graph.js';
import type { RecipeBook, RecipeNode } from './types.js';
import { BASIC_RECIPES, d, q, recipesOf } from './__fixtures__/kitchen.js';

function node(itemId: string, componentIds: string[]): RecipeNode {
  return {
    itemId,
    lines: componentIds.map((id) => ({ itemId: id, quantity: q('100', 'g') })),
    yieldFactor: d('1'),
    outputQuantity: q('100', 'g'),
    portions: 1,
  };
}

/** plato -> salsa -> fondo -> sofrito, mas una materia prima en cada nivel. */
const CADENA: RecipeBook = recipesOf([
  node('plato', ['salsa', 'sal']),
  node('salsa', ['fondo', 'nata']),
  node('fondo', ['sofrito', 'agua']),
  node('sofrito', ['cebolla', 'aceite']),
]);

describe('dependencias', () => {
  it('solo cuenta las lineas que son a su vez elaboraciones', () => {
    expect(dependenciesOf('salsa', CADENA)).toEqual(['fondo']);
    expect(dependenciesOf('sofrito', CADENA)).toEqual([]);
  });

  it('devuelve vacio para un item que no tiene receta', () => {
    expect(dependenciesOf('cebolla', CADENA)).toEqual([]);
  });

  it('no repite una elaboracion usada dos veces en la misma receta', () => {
    const recipes = recipesOf([node('plato', ['salsa', 'salsa']), node('salsa', ['cebolla'])]);
    expect(dependenciesOf('plato', recipes)).toEqual(['salsa']);
  });
});

describe('orden topologico', () => {
  it('coloca cada dependencia antes que quien la usa', () => {
    const order = topologicalOrder(CADENA);
    expect(order).toEqual(['sofrito', 'fondo', 'salsa', 'plato']);
  });

  it('recorre solo el subgrafo alcanzable cuando se dan raices', () => {
    expect(topologicalOrder(CADENA, ['fondo'])).toEqual(['sofrito', 'fondo']);
  });

  it('ignora raices que no son elaboraciones', () => {
    expect(topologicalOrder(CADENA, ['cebolla'])).toEqual([]);
    expect(topologicalOrder(CADENA, ['cebolla', 'sofrito'])).toEqual(['sofrito']);
  });

  it('visita una sola vez los nodos compartidos por dos ramas (diamante)', () => {
    const diamante = recipesOf([
      node('plato', ['salsa_a', 'salsa_b']),
      node('salsa_a', ['fondo']),
      node('salsa_b', ['fondo']),
      node('fondo', ['cebolla']),
    ]);
    const order = topologicalOrder(diamante);
    expect(order).toEqual(['fondo', 'salsa_a', 'salsa_b', 'plato']);
    expect(new Set(order).size).toBe(order.length);
  });

  it('el orden de la cocina de ejemplo resuelve la salsa antes que el plato', () => {
    expect(topologicalOrder(BASIC_RECIPES, ['plato_alcachofas'])).toEqual([
      'salsa_alcachofa',
      'plato_alcachofas',
    ]);
  });
});

describe('deteccion de ciclos', () => {
  it('detecta una elaboracion que se contiene a si misma', () => {
    const recipes = recipesOf([node('salsa', ['salsa'])]);
    expect(() => topologicalOrder(recipes)).toThrow(CyclicRecipeError);
    expect(findCycle(recipes)).toEqual(['salsa', 'salsa']);
  });

  it('detecta un ciclo indirecto y devuelve la ruta completa', () => {
    const recipes = recipesOf([
      node('plato', ['salsa']),
      node('salsa', ['fondo']),
      node('fondo', ['salsa']),
    ]);
    expect(findCycle(recipes, ['plato'])).toEqual(['salsa', 'fondo', 'salsa']);
    try {
      topologicalOrder(recipes, ['plato']);
      expect.unreachable('deberia haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(CyclicRecipeError);
      expect((error as CyclicRecipeError).message).toContain('salsa -> fondo -> salsa');
    }
  });

  it('devuelve null cuando el grafo es acíclico', () => {
    expect(findCycle(CADENA)).toBeNull();
  });
});

describe('dependientes (recalculo en cascada)', () => {
  it('encuentra todo lo que hay que recalcular al cambiar una materia prima', () => {
    expect(dependentsOf('cebolla', CADENA).sort()).toEqual(['fondo', 'plato', 'salsa', 'sofrito']);
  });

  it('encuentra los dependientes de una elaboracion intermedia', () => {
    expect(dependentsOf('fondo', CADENA).sort()).toEqual(['plato', 'salsa']);
  });

  it('devuelve vacio para el plato, que no lo usa nadie', () => {
    expect(dependentsOf('plato', CADENA)).toEqual([]);
  });

  it('devuelve vacio para un item que no aparece en ninguna receta', () => {
    expect(dependentsOf('trufa', CADENA)).toEqual([]);
  });

  it('no duplica cuando un item aparece dos veces en la misma receta', () => {
    const recipes = recipesOf([node('plato', ['sal', 'sal'])]);
    expect(dependentsOf('sal', recipes)).toEqual(['plato']);
  });

  it('no se pierde en un diamante', () => {
    const diamante = recipesOf([
      node('plato', ['salsa_a', 'salsa_b']),
      node('salsa_a', ['fondo']),
      node('salsa_b', ['fondo']),
      node('fondo', ['cebolla']),
    ]);
    expect(dependentsOf('cebolla', diamante).sort()).toEqual([
      'fondo',
      'plato',
      'salsa_a',
      'salsa_b',
    ]);
  });
});

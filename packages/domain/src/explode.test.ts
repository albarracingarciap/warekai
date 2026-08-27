import { describe, expect, it } from 'vitest';
import {
  InvalidValueError,
  InvalidYieldError,
  MissingPurchasePriceError,
  UnknownItemError,
  UnknownRecipeError,
} from './errors.js';
import {
  assertRecipeNode,
  buildUnitCostIndex,
  costingUnitOf,
  explodeRecipe,
  requireItem,
  requireRecipe,
  type UnitCost,
} from './explode.js';
import type { RecipeNode } from './types.js';
import {
  ALCACHOFA,
  BASIC_CATALOG,
  BASIC_RECIPES,
  CEBOLLA,
  PLATO,
  SALSA,
  catalogOf,
  d,
  item,
  q,
  recipesOf,
} from './__fixtures__/kitchen.js';

describe('guardas de entrada', () => {
  it('exige que el item exista en el catalogo', () => {
    expect(() => requireItem(BASIC_CATALOG, 'trufa_blanca')).toThrow(UnknownItemError);
    expect(requireItem(BASIC_CATALOG, 'cebolla').id).toBe('cebolla');
  });

  it('exige que la receta exista', () => {
    expect(() => requireRecipe(BASIC_RECIPES, 'cebolla')).toThrow(UnknownRecipeError);
    expect(requireRecipe(BASIC_RECIPES, 'salsa_alcachofa').itemId).toBe('salsa_alcachofa');
  });

  it('valida los invariantes de la receta', () => {
    expect(assertRecipeNode(SALSA)).toBe(SALSA);
    expect(() => assertRecipeNode({ ...SALSA, yieldFactor: d('0') })).toThrow(InvalidYieldError);
    expect(() => assertRecipeNode({ ...SALSA, outputQuantity: q('0', 'ml') })).toThrow(
      /cantidad de salida/,
    );
    expect(() => assertRecipeNode({ ...SALSA, portions: 0 })).toThrow(InvalidValueError);
    expect(() => assertRecipeNode({ ...SALSA, portions: 2.5 })).toThrow(/raciones/);
  });

  it('costea las elaboraciones en su unidad de salida y las materias primas en la de uso', () => {
    expect(costingUnitOf(ALCACHOFA, BASIC_RECIPES)).toBe('g');
    expect(costingUnitOf(requireItem(BASIC_CATALOG, 'salsa_alcachofa'), BASIC_RECIPES)).toBe('ml');
  });
});

describe('indice de costes unitarios', () => {
  const index = buildUnitCostIndex(BASIC_CATALOG, BASIC_RECIPES);

  it('costea las materias primas a partir del precio de compra', () => {
    expect((index.get('alcachofa') as UnitCost).cost.exactCents.toString()).toBe('0.4');
    expect((index.get('aceite') as UnitCost).cost.exactCents.toString()).toBe('1');
    expect((index.get('cebolla') as UnitCost).cost.exactCents.toString()).toBe('0.08');
  });

  it('costea la elaboracion aplicando la merma de proceso', () => {
    // 5,00 EUR de entradas repartidos entre los 400 ml que quedan tras reducir.
    const salsa = index.get('salsa_alcachofa') as UnitCost;
    expect(salsa.cost.exactCents.toString()).toBe('1.25');
    expect(salsa.unit).toBe('ml');
  });

  it('no recalcula una materia prima que ya esta en el indice', () => {
    const recipes = recipesOf([
      {
        itemId: 'salsa_alcachofa',
        lines: [
          { itemId: 'aceite', quantity: q('50', 'ml') },
          { itemId: 'aceite', quantity: q('50', 'ml') },
        ],
        yieldFactor: d('1'),
        outputQuantity: q('100', 'ml'),
        portions: 1,
      },
    ]);
    const built = buildUnitCostIndex(BASIC_CATALOG, recipes);
    expect((built.get('salsa_alcachofa') as UnitCost).cost.exactCents.toString()).toBe('1');
  });

  it('exige precio de compra en las materias primas', () => {
    const sinPrecio = item({ id: 'sal', name: 'Sal', usageUnit: 'g', stockToUsage: '1000' });
    const catalog = catalogOf([sinPrecio, requireItem(BASIC_CATALOG, 'salsa_alcachofa')]);
    const recipes = recipesOf([{ ...SALSA, lines: [{ itemId: 'sal', quantity: q('10', 'g') }] }]);
    expect(() => buildUnitCostIndex(catalog, recipes)).toThrow(MissingPurchasePriceError);
  });

  it('exige que el item de la propia elaboracion este en el catalogo', () => {
    const catalog = catalogOf([ALCACHOFA]);
    const recipes = recipesOf([
      { ...SALSA, lines: [{ itemId: 'alcachofa', quantity: q('100', 'g') }] },
    ]);
    expect(() => buildUnitCostIndex(catalog, recipes)).toThrow(UnknownItemError);
  });

  it('acota el trabajo al subgrafo pedido', () => {
    const parcial = buildUnitCostIndex(BASIC_CATALOG, BASIC_RECIPES, ['salsa_alcachofa']);
    expect(parcial.has('salsa_alcachofa')).toBe(true);
    expect(parcial.has('plato_alcachofas')).toBe(false);
  });
});

describe('explosion recursiva', () => {
  const lines = explodeRecipe('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES);

  it('devuelve el arbol en preorden con su profundidad', () => {
    expect(lines.map((l) => [l.itemId, l.depth])).toEqual([
      ['salsa_alcachofa', 0],
      ['alcachofa', 1],
      ['aceite', 1],
      ['cebolla', 0],
    ]);
  });

  it('marca cuales son elaboraciones', () => {
    expect(lines.filter((l) => l.isPreparation).map((l) => l.itemId)).toEqual(['salsa_alcachofa']);
  });

  it('registra la ruta desde la raiz', () => {
    expect(lines[1]!.path).toEqual(['salsa_alcachofa', 'alcachofa']);
  });

  it('escala los niveles inferiores a la fraccion del lote realmente consumida', () => {
    // El plato usa 200 de los 400 ml que rinde la salsa: la mitad del lote.
    expect(lines[1]!.netQuantity.toString()).toBe('200 g'); // 400 g netos x 0,5
    expect(lines[2]!.netQuantity.toString()).toBe('50 ml'); // 100 ml x 0,5
  });

  it('deshace la merma de limpieza para llegar al peso de compra', () => {
    expect(lines[1]!.grossQuantity.toString()).toBe('500 g'); // 200 g netos / 0,4
    expect(lines[1]!.cleaningYield.toString()).toBe('0.4');
    expect(lines[3]!.grossQuantity.amount.toFixed(4)).toBe('111.1111'); // 100 g / 0,9
  });

  it('la suma de las lineas hijas es exactamente el coste de la linea padre', () => {
    const padre = lines[0]!.lineCost;
    const hijas = lines[1]!.lineCost.plus(lines[2]!.lineCost);
    expect(hijas.exactCents.toString()).toBe(padre.exactCents.toString());
    expect(padre.exactCents.toString()).toBe('250');
  });

  it('respeta el factor de correccion propio de la linea cuando lo hay', () => {
    const recipes = recipesOf([
      {
        ...PLATO,
        lines: [{ itemId: 'cebolla', quantity: q('100', 'g'), cleaningYieldOverride: d('0.5') }],
      },
    ]);
    const [linea] = explodeRecipe('plato_alcachofas', BASIC_CATALOG, recipes);
    expect(linea!.cleaningYield.toString()).toBe('0.5');
    expect(linea!.grossQuantity.toString()).toBe('200 g');
  });

  it('costea al vuelo una hoja que no estuviera en el indice', () => {
    const completo = buildUnitCostIndex(BASIC_CATALOG, BASIC_RECIPES, ['plato_alcachofas']);
    const recortado = new Map(completo);
    recortado.delete('cebolla');
    const conRecorte = explodeRecipe('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES, recortado);
    expect(conRecorte[3]!.lineCost.exactCents.toString()).toBe(
      lines[3]!.lineCost.exactCents.toString(),
    );
  });

  it('convierte la unidad de la linea a la unidad de coste del item', () => {
    // La receta pide kilos; la alcachofa se costea por gramo.
    const recipes = recipesOf([
      { ...PLATO, lines: [{ itemId: 'alcachofa', quantity: q('0.4', 'kg') }] },
    ]);
    const [linea] = explodeRecipe('plato_alcachofas', BASIC_CATALOG, recipes);
    expect(linea!.grossQuantity.toString()).toBe('1000 g');
    expect(linea!.lineCost.exactCents.toString()).toBe('400');
  });

  it('resuelve media cebolla usando el peso por pieza', () => {
    const recipes = recipesOf([
      { ...PLATO, lines: [{ itemId: 'cebolla', quantity: q('0.5', 'ud') }] },
    ]);
    const [linea] = explodeRecipe('plato_alcachofas', BASIC_CATALOG, recipes);
    // 0,5 ud netas / 0,9 = 0,5555 ud -> x150 g = 83,33 g
    expect(linea!.grossQuantity.amount.toFixed(4)).toBe('83.3333');
  });

  it('exige que la raiz sea una receta', () => {
    expect(() => explodeRecipe('cebolla', BASIC_CATALOG, BASIC_RECIPES)).toThrow(
      UnknownRecipeError,
    );
  });

  it('conserva el nombre del item para la ficha tecnica', () => {
    expect(lines[3]!.itemName).toBe(CEBOLLA.name);
  });
});

describe('profundidad ilimitada', () => {
  /** Cadena de N elaboraciones, cada una reduciendo al 50 %. */
  function chain(depth: number): { recipes: ReturnType<typeof recipesOf> } {
    const nodes: RecipeNode[] = [];
    for (let i = 0; i < depth; i += 1) {
      nodes.push({
        itemId: `nivel_${i}`,
        lines: [
          i === depth - 1
            ? { itemId: 'aceite', quantity: q('100', 'ml') }
            : { itemId: `nivel_${i + 1}`, quantity: q('100', 'ml') },
        ],
        yieldFactor: d('0.5'),
        outputQuantity: q('200', 'ml'),
        portions: 1,
      });
    }
    return { recipes: recipesOf(nodes) };
  }

  it('explota veinte niveles anidados sin perder exactitud', () => {
    const depth = 20;
    const { recipes } = chain(depth);
    const catalog = catalogOf([
      requireItem(BASIC_CATALOG, 'aceite'),
      ...Array.from({ length: depth }, (_, i) =>
        item({
          id: `nivel_${i}`,
          name: `Nivel ${i}`,
          kinds: ['PREP'],
          usageUnit: 'ml',
          stockToUsage: '1000',
        }),
      ),
    ]);
    const lines = explodeRecipe('nivel_0', catalog, recipes);
    expect(lines).toHaveLength(depth);
    expect(lines[depth - 1]!.depth).toBe(depth - 1);
    // Cada nivel consume 100 de los 100 ml que rinde el inferior: la cadena es
    // neutra en cantidad, y el coste del aceite llega intacto hasta arriba.
    expect(lines[depth - 1]!.grossQuantity.toString()).toBe('100 ml');
    expect(lines[0]!.lineCost.exactCents.toString()).toBe('100');
  });
});

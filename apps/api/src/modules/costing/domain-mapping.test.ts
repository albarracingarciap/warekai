import { calculateRecipeCost } from '@warekai/domain';
import { describe, expect, it } from 'vitest';
import { toCatalog, toRecipeBook, type ItemRowForDomain } from './domain-mapping';

/**
 * La frontera donde el `numeric` de Postgres se convierte en `Decimal`.
 *
 * Se prueba con el caso del enunciado -- alcachofa al 40 % dentro de una salsa
 * reducida, dentro de un plato de tres raciones -- partiendo de cadenas, que es
 * lo que devuelve el driver, para comprobar que la exactitud sobrevive al
 * viaje.
 */
const items: ItemRowForDomain[] = [
  {
    id: 'alcachofa',
    name: 'Alcachofa',
    kinds: ['RAW'],
    purchaseUnitLabel: 'caja',
    stockUnitLabel: 'kg',
    usageUnit: 'g',
    purchaseToStock: '5.000000',
    stockToUsage: '1000.000000',
    densityGPerMl: null,
    weightPerPieceG: null,
    purchasePriceCents: 2000,
    cleaningYield: '0.4000',
    vatRate: '0.1000',
    allergens: [],
  },
  {
    id: 'aceite',
    name: 'Aceite',
    kinds: ['RAW'],
    purchaseUnitLabel: 'caja',
    stockUnitLabel: 'botella',
    usageUnit: 'ml',
    purchaseToStock: '6.000000',
    stockToUsage: '700.000000',
    densityGPerMl: '0.916000',
    weightPerPieceG: null,
    purchasePriceCents: 4200,
    cleaningYield: '1.0000',
    vatRate: '0.1000',
    allergens: [{ code: 'SULFITOS', level: 'TRACES' }],
  },
  {
    id: 'salsa',
    name: 'Salsa de alcachofa',
    kinds: ['PREP'],
    purchaseUnitLabel: 'lote',
    stockUnitLabel: 'lote',
    usageUnit: 'ml',
    purchaseToStock: '1.000000',
    stockToUsage: '1.000000',
    densityGPerMl: null,
    weightPerPieceG: null,
    purchasePriceCents: null,
    cleaningYield: '1.0000',
    vatRate: '0.1000',
    allergens: [],
  },
  {
    id: 'plato',
    name: 'Alcachofas con su salsa',
    kinds: ['SALE'],
    purchaseUnitLabel: 'lote',
    stockUnitLabel: 'lote',
    usageUnit: 'ud',
    purchaseToStock: '1.000000',
    stockToUsage: '1.000000',
    densityGPerMl: null,
    weightPerPieceG: null,
    purchasePriceCents: null,
    cleaningYield: '1.0000',
    vatRate: '0.1000',
    allergens: [],
  },
];

const recipes = [
  {
    itemId: 'salsa',
    yieldFactor: '0.4000',
    outputQuantity: '1000.000000',
    outputUnit: 'ml' as const,
    portions: 4,
    lines: [
      {
        itemId: 'alcachofa',
        quantity: '400.000000',
        unit: 'g' as const,
        cleaningYieldOverride: null,
      },
      {
        itemId: 'aceite',
        quantity: '100.000000',
        unit: 'ml' as const,
        cleaningYieldOverride: null,
      },
    ],
  },
  {
    itemId: 'plato',
    yieldFactor: '1.0000',
    outputQuantity: '3.000000',
    outputUnit: 'ud' as const,
    portions: 3,
    lines: [
      { itemId: 'salsa', quantity: '200.000000', unit: 'ml' as const, cleaningYieldOverride: null },
    ],
  },
];

describe('mapeo de filas a dominio', () => {
  const catalog = toCatalog(items);
  const book = toRecipeBook(recipes);

  it('reconstruye los decimales sin pasar por coma flotante', () => {
    const alcachofa = catalog.get('alcachofa');
    expect(alcachofa?.cleaningYield.toString()).toBe('0.4');
    expect(alcachofa?.units.purchaseToStock.toString()).toBe('5');
    expect(catalog.get('aceite')?.units.densityGPerMl?.toString()).toBe('0.916');
  });

  it('deja los puentes ausentes sin definir en vez de en cero', () => {
    // Un `undefined` hace que el motor lance "falta la densidad"; un cero
    // haria que dividiese por cero en silencio.
    expect(catalog.get('alcachofa')?.units.densityGPerMl).toBeUndefined();
  });

  it('conserva los alergenos', () => {
    expect(catalog.get('aceite')?.allergens).toEqual([{ code: 'SULFITOS', level: 'TRACES' }]);
  });

  it('el escandallo del caso de referencia sale exacto', () => {
    const breakdown = calculateRecipeCost('plato', catalog, book);
    // 400 g netos de alcachofa = 1000 g de compra = 400 centimos
    // + 100 ml de aceite = 100 centimos -> 500 centimos de entradas
    // salida 1000 ml x 0,4 = 400 ml -> 1,25 centimos/ml
    // el plato usa 200 ml -> 250 centimos entre 3 raciones
    expect(breakdown.totalCost.exactCents.toString()).toBe('250');
    expect(breakdown.costPerPortion.exactCents.toFixed(6)).toBe('83.333333');
  });

  it('la merma de la linea manda sobre la del item cuando existe', () => {
    const conOverride = toRecipeBook([
      {
        ...recipes[0]!,
        lines: [
          {
            itemId: 'alcachofa',
            quantity: '400.000000',
            unit: 'g' as const,
            cleaningYieldOverride: '0.8000',
          },
        ],
      },
      recipes[1]!,
    ]);
    const breakdown = calculateRecipeCost('salsa', catalog, conOverride);
    // 400 / 0,8 = 500 g de compra -> 200 centimos, no 400.
    expect(breakdown.totalCost.exactCents.toString()).toBe('200');
  });
});

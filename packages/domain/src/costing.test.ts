import { describe, expect, it } from 'vitest';
import {
  calculateRecipeCost,
  foodCostPercentage,
  foodCostRatio,
  grossMargin,
  grossMarginPercentage,
  grossPriceFromNet,
  netPriceFromGross,
} from './costing.js';
import { DivisionByZeroError, UnknownItemError, UnknownRecipeError } from './errors.js';
import { buildUnitCostIndex } from './explode.js';
import { Money } from './money.js';
import { BASIC_CATALOG, BASIC_RECIPES, SALSA_ITEM, catalogOf, d } from './__fixtures__/kitchen.js';

/**
 * El caso del enunciado, verificado a mano.
 *
 * Alcachofa: caja de 5 kg a 20,00 EUR -> 0,4 centimos/g. Rinde el 40 %.
 * Aceite:    caja de 6 x 700 ml a 42,00 EUR -> 1 centimo/ml.
 * Cebolla:   saco de 10 kg a 8,00 EUR -> 0,08 centimos/g. Rinde el 90 %.
 *
 * Salsa (reduce al 40 %):
 *   400 g netos de alcachofa = 1000 g de compra = 400 centimos
 *   100 ml de aceite                            = 100 centimos
 *   entradas 500 centimos, salida 1000 ml x 0,4 = 400 ml
 *   -> 1,25 centimos/ml
 *
 * Plato (3 raciones):
 *   200 ml de salsa                = 250 centimos
 *   100 g netos de cebolla = 111,11 g de compra = 8,888... centimos
 *   -> total 258,888... centimos; por racion 86,296... centimos
 */
describe('escandallo del plato del enunciado', () => {
  const breakdown = calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES);

  it('calcula el coste total del lote', () => {
    expect(breakdown.totalCost.exactCents.toFixed(6)).toBe('258.888889');
    expect(breakdown.totalCost.toEuros()).toBe('2.59');
  });

  it('calcula el coste por racion sin redondear por el camino', () => {
    expect(breakdown.costPerPortion.exactCents.toFixed(6)).toBe('86.296296');
    expect(breakdown.costPerPortion.cents).toBe(86);
    expect(breakdown.portions).toBe(3);
  });

  it('el coste total es exactamente la suma de las lineas de primer nivel', () => {
    const directas = breakdown.lines.filter((l) => l.depth === 0);
    const suma = Money.sum(directas.map((l) => l.lineCost));
    expect(suma.exactCents.toString()).toBe(breakdown.totalCost.exactCents.toString());
  });

  it('el coste total es tambien la suma de las hojas del arbol', () => {
    // Las hojas son las materias primas a cualquier profundidad: alcachofa,
    // aceite y cebolla. Que ambas sumas coincidan prueba que la explosion no
    // duplica ni pierde coste al bajar de nivel.
    const hojas = breakdown.lines.filter((l) => !l.isPreparation);
    expect(Money.sum(hojas.map((l) => l.lineCost)).exactCents.toFixed(6)).toBe('258.888889');
  });

  it('informa de la produccion real del lote', () => {
    expect(breakdown.netOutput.toString()).toBe('3 ud');
    expect(breakdown.costPerOutputUnit.exactCents.toFixed(6)).toBe('86.296296');
  });

  it('identifica la receta', () => {
    expect(breakdown.itemId).toBe('plato_alcachofas');
    expect(breakdown.itemName).toBe('Alcachofas confitadas con su salsa');
  });
});

describe('escandallo de la elaboracion intermedia', () => {
  const breakdown = calculateRecipeCost('salsa_alcachofa', BASIC_CATALOG, BASIC_RECIPES);

  it('la merma de proceso no cambia el coste total, solo el coste por unidad', () => {
    expect(breakdown.totalCost.exactCents.toString()).toBe('500');
    expect(breakdown.netOutput.toString()).toBe('400 ml');
    expect(breakdown.costPerOutputUnit.exactCents.toString()).toBe('1.25');
  });

  it('el coste por racion usa las raciones declaradas del lote', () => {
    expect(breakdown.portions).toBe(4);
    expect(breakdown.costPerPortion.exactCents.toString()).toBe('125');
  });
});

describe('doble merma encadenada', () => {
  it('subir el rendimiento de limpieza de la alcachofa abarata el plato', () => {
    const mejor = new Map(BASIC_CATALOG);
    mejor.set('alcachofa', {
      ...BASIC_CATALOG.get('alcachofa')!,
      cleaningYield: d('0.8'),
    });
    const original = calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES);
    const conMejora = calculateRecipeCost('plato_alcachofas', mejor, BASIC_RECIPES);
    // La alcachofa pasa de costar 400 a 200 centimos en el lote de salsa;
    // el plato consume la mitad de ese lote: -100 centimos.
    expect(original.totalCost.minus(conMejora.totalCost).exactCents.toString()).toBe('100');
  });

  it('reducir mas la salsa encarece el plato en proporcion inversa', () => {
    const recipes = new Map(BASIC_RECIPES);
    recipes.set('salsa_alcachofa', {
      ...BASIC_RECIPES.get('salsa_alcachofa')!,
      yieldFactor: d('0.2'),
    });
    const breakdown = calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, recipes);
    // La salsa rinde 200 ml en vez de 400: 2,5 centimos/ml y 500 en la linea.
    expect(breakdown.lines[0]!.lineCost.exactCents.toString()).toBe('500');
  });
});

describe('calculateRecipeCost: guardas y reutilizacion de indice', () => {
  it('exige receta e item', () => {
    expect(() => calculateRecipeCost('cebolla', BASIC_CATALOG, BASIC_RECIPES)).toThrow(
      UnknownRecipeError,
    );
    // El catalogo tiene todo menos el item que la propia receta produce.
    const catalogSinPlato = catalogOf([
      BASIC_CATALOG.get('alcachofa')!,
      BASIC_CATALOG.get('aceite')!,
      BASIC_CATALOG.get('cebolla')!,
      SALSA_ITEM,
    ]);
    expect(() => calculateRecipeCost('plato_alcachofas', catalogSinPlato, BASIC_RECIPES)).toThrow(
      UnknownItemError,
    );
  });

  it('acepta un indice ya construido y da el mismo resultado', () => {
    const index = buildUnitCostIndex(BASIC_CATALOG, BASIC_RECIPES);
    const conIndice = calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES, index);
    const sinIndice = calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES);
    expect(conIndice.totalCost.exactCents.toString()).toBe(
      sinIndice.totalCost.exactCents.toString(),
    );
  });
});

describe('food cost y margen', () => {
  const coste = Money.fromCents(280);
  const pvpNeto = Money.fromCents(1000);

  it('food cost como fraccion y como porcentaje', () => {
    expect(foodCostRatio(coste, pvpNeto).toString()).toBe('0.28');
    expect(foodCostPercentage(coste, pvpNeto).toString()).toBe('28');
  });

  it('margen bruto en dinero y en porcentaje', () => {
    expect(grossMargin(coste, pvpNeto).toEuros()).toBe('7.20');
    expect(grossMarginPercentage(coste, pvpNeto).toString()).toBe('72');
  });

  it('food cost y margen son complementarios', () => {
    const suma = foodCostPercentage(coste, pvpNeto).plus(grossMarginPercentage(coste, pvpNeto));
    expect(suma.toString()).toBe('100');
  });

  it('un PVP de cero no se divide en silencio', () => {
    expect(() => foodCostRatio(coste, Money.zero())).toThrow(DivisionByZeroError);
  });
});

describe('IVA', () => {
  it('quita y pone el 10 % de restauracion', () => {
    expect(netPriceFromGross(Money.fromCents(1100), d('0.10')).exactCents.toString()).toBe('1000');
    expect(grossPriceFromNet(Money.fromCents(1000), d('0.10')).exactCents.toString()).toBe('1100');
  });

  it('ida y vuelta es la identidad exacta', () => {
    const neto = Money.fromCents(1234);
    const ida = grossPriceFromNet(neto, d('0.21'));
    expect(netPriceFromGross(ida, d('0.21')).exactCents.toString()).toBe('1234');
  });

  it('el food cost sobre PVP con IVA saldria mas bajo, por eso se usa el neto', () => {
    const coste = Money.fromCents(280);
    const conIva = Money.fromCents(1100);
    const neto = netPriceFromGross(conIva, d('0.10'));
    expect(foodCostRatio(coste, neto).toString()).toBe('0.28');
    expect(foodCostRatio(coste, conIva).lessThan(foodCostRatio(coste, neto))).toBe(true);
  });
});

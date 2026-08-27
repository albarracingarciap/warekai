import { describe, expect, it } from 'vitest';
import { calculateRecipeCost } from './costing.js';
import { InvalidValueError } from './errors.js';
import { Money } from './money.js';
import {
  foodCostOfListedPrice,
  markupForTargetFoodCost,
  priceForTargetFoodCost,
  roundPrice,
  type RoundingStrategy,
} from './pricing.js';
import { Decimal } from './decimal.js';
import { BASIC_CATALOG, BASIC_RECIPES, d } from './__fixtures__/kitchen.js';

/** Decimal no finito, para ejercitar las guardas de `isFinite`. */
const NO_FINITO = new Decimal(Number.NaN);

describe('redondeo de precios', () => {
  const cases: Array<[RoundingStrategy, string, string]> = [
    ['NONE', '1143', '11.43'],
    ['UP_TO_5_CENTS', '1141', '11.45'],
    ['UP_TO_5_CENTS', '1145', '11.45'],
    ['UP_TO_10_CENTS', '1141', '11.50'],
    ['UP_TO_50_CENTS', '1143', '11.50'],
    ['UP_TO_50_CENTS', '1150', '11.50'],
    ['UP_TO_EURO', '1101', '12.00'],
    ['CHARM_90', '1143', '11.90'],
    ['CHARM_90', '1195', '12.90'],
    ['CHARM_90', '1190', '11.90'],
  ];

  it.each(cases)('%s sobre %s centimos da %s EUR', (strategy, cents, expected) => {
    expect(roundPrice(Money.fromExactCents(cents), strategy).toEuros()).toBe(expected);
  });

  it('nunca redondea a la baja: bajar el precio empeora el food cost', () => {
    const precio = Money.fromExactCents('1143');
    for (const strategy of [
      'UP_TO_5_CENTS',
      'UP_TO_10_CENTS',
      'UP_TO_50_CENTS',
      'UP_TO_EURO',
      'CHARM_90',
    ] as RoundingStrategy[]) {
      expect(roundPrice(precio, strategy).lessThan(precio)).toBe(false);
    }
  });

  it('NONE solo lleva los centimos fraccionarios a entero', () => {
    expect(roundPrice(Money.fromExactCents('1143.6'), 'NONE').cents).toBe(1144);
  });
});

describe('PVP para un food cost objetivo', () => {
  it('resuelve el caso de manual: 3,20 EUR de coste al 28 % con IVA del 10 %', () => {
    const suggestion = priceForTargetFoodCost(Money.fromCents(320), d('0.28'), d('0.10'));
    expect(suggestion.netPrice.exactCents.toFixed(4)).toBe('1142.8571');
    expect(suggestion.vatAmount.exactCents.toFixed(4)).toBe('114.2857');
    expect(suggestion.grossPrice.exactCents.toFixed(4)).toBe('1257.1429');
    expect(suggestion.roundedGrossPrice.toEuros()).toBe('13.00');
  });

  it('el objetivo se cumple exactamente antes de redondear', () => {
    const coste = Money.fromCents(320);
    const suggestion = priceForTargetFoodCost(coste, d('0.28'), d('0.10'), { rounding: 'NONE' });
    expect(coste.ratioTo(suggestion.netPrice).toFixed(4)).toBe('0.2800');
  });

  it('redondear hacia arriba mejora el food cost real', () => {
    const coste = Money.fromCents(320);
    const suggestion = priceForTargetFoodCost(coste, d('0.28'), d('0.10'));
    expect(suggestion.effectiveFoodCost.lessThan(d('0.28'))).toBe(true);
    expect(suggestion.effectiveFoodCost.toFixed(4)).toBe('0.2708');
  });

  it('devuelve la base imponible del precio de carta y el margen', () => {
    const suggestion = priceForTargetFoodCost(Money.fromCents(320), d('0.28'), d('0.10'));
    expect(suggestion.roundedNetPrice.exactCents.toFixed(4)).toBe('1181.8182');
    expect(suggestion.grossMargin.exactCents.toFixed(4)).toBe('861.8182');
  });

  it('funciona sobre el escandallo real del plato de tres raciones', () => {
    const { costPerPortion } = calculateRecipeCost(
      'plato_alcachofas',
      BASIC_CATALOG,
      BASIC_RECIPES,
    );
    const suggestion = priceForTargetFoodCost(costPerPortion, d('0.28'), d('0.10'));
    expect(suggestion.netPrice.exactCents.toFixed(4)).toBe('308.2011');
    expect(suggestion.roundedGrossPrice.toEuros()).toBe('3.50');
    expect(suggestion.effectiveFoodCost.toFixed(4)).toBe('0.2712');
  });

  it('un coste de cero da food cost efectivo cero en vez de dividir', () => {
    const suggestion = priceForTargetFoodCost(Money.zero(), d('0.3'), d('0.10'));
    expect(suggestion.effectiveFoodCost.toString()).toBe('0');
    expect(suggestion.roundedGrossPrice.isZero()).toBe(true);
  });

  it('admite IVA cero', () => {
    const suggestion = priceForTargetFoodCost(Money.fromCents(100), d('0.5'), d('0'), {
      rounding: 'NONE',
    });
    expect(suggestion.vatAmount.isZero()).toBe(true);
    expect(suggestion.grossPrice.exactCents.toString()).toBe('200');
  });

  it('rechaza objetivos, IVA y costes invalidos', () => {
    const coste = Money.fromCents(320);
    expect(() => priceForTargetFoodCost(coste, d('28'), d('0.10'))).toThrow(/0\.28/);
    expect(() => priceForTargetFoodCost(coste, d('0'), d('0.10'))).toThrow(InvalidValueError);
    expect(() => priceForTargetFoodCost(coste, NO_FINITO, d('0.10'))).toThrow(InvalidValueError);
    expect(() => priceForTargetFoodCost(coste, d('0.28'), NO_FINITO)).toThrow(InvalidValueError);
    expect(() => priceForTargetFoodCost(coste, d('0.28'), d('-0.1'))).toThrow(/IVA/);
    expect(() => priceForTargetFoodCost(Money.fromCents(-1), d('0.28'), d('0.10'))).toThrow(
      /coste por racion/,
    );
  });
});

describe('lecturas inversas', () => {
  it('calcula el food cost de un precio ya fijado en carta', () => {
    // 12,10 EUR con IVA -> 11,00 EUR de base; 3,08 EUR de coste -> 28 %
    expect(
      foodCostOfListedPrice(Money.fromCents(308), Money.fromCents(1210), d('0.10')).toString(),
    ).toBe('0.28');
  });

  it('traduce el objetivo a un multiplicador sobre coste', () => {
    expect(markupForTargetFoodCost(d('0.28')).toFixed(4)).toBe('3.5714');
    expect(markupForTargetFoodCost(d('1')).toString()).toBe('1');
  });

  it('rechaza multiplicadores imposibles', () => {
    expect(() => markupForTargetFoodCost(d('0'))).toThrow(InvalidValueError);
    expect(() => markupForTargetFoodCost(d('1.5'))).toThrow(InvalidValueError);
    expect(() => markupForTargetFoodCost(NO_FINITO)).toThrow(InvalidValueError);
  });
});

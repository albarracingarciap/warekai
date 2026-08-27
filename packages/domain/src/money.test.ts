import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.js';
import { DivisionByZeroError, InvalidValueError } from './errors.js';
import { Money } from './money.js';

describe('Money — construccion', () => {
  it('construye desde centimos enteros', () => {
    expect(Money.fromCents(1235).toEuros()).toBe('12.35');
    expect(Money.fromCents('1235').toEuros()).toBe('12.35');
    expect(Money.fromCents(new Decimal(1235)).toEuros()).toBe('12.35');
  });

  it('rechaza centimos fraccionarios en fromCents', () => {
    expect(() => Money.fromCents(12.5)).toThrow(InvalidValueError);
  });

  it('rechaza valores no finitos', () => {
    expect(() => Money.fromCents(Number.POSITIVE_INFINITY)).toThrow(InvalidValueError);
    expect(() => Money.fromExactCents(Number.NaN)).toThrow(InvalidValueError);
    expect(() => Money.fromEuros('no-es-un-numero')).toThrow(InvalidValueError);
    expect(() => Money.fromEuros(new Decimal(Number.NaN))).toThrow(/importe en euros/);
  });

  it('traduce el error de decimal.js nombrando el campo', () => {
    expect(() => Money.fromCents('doce euros')).toThrow(/importe.*doce euros/s);
    expect(() => Money.fromCents(100).times('mucho')).toThrow(/factor/);
    expect(() => Money.fromCents(100).dividedBy('poco')).toThrow(/divisor/);
    expect(() => Money.fromCents(100).allocate(['mitad'])).toThrow(/proporcion de reparto/);
  });

  it('admite centimos fraccionarios por la via explicita', () => {
    expect(Money.fromExactCents('0.004').exactCents.toString()).toBe('0.004');
    expect(Money.fromExactCents(new Decimal('0.5')).exactCents.toString()).toBe('0.5');
  });

  it('construye desde euros en cadena, nunca desde coma flotante', () => {
    expect(Money.fromEuros('0.1').plus(Money.fromEuros('0.2')).toEuros()).toBe('0.30');
    expect(Money.fromEuros(new Decimal('1.005')).exactCents.toString()).toBe('100.5');
  });

  it('cero es el elemento neutro de la suma de listas', () => {
    expect(Money.sum([]).isZero()).toBe(true);
    expect(Money.sum([Money.fromCents(100), Money.fromCents(23)]).cents).toBe(123);
    expect(Money.zero().isZero()).toBe(true);
  });
});

describe('Money — aritmetica exacta', () => {
  it('no acumula error de coma flotante al sumar decimas cien veces', () => {
    let total = Money.zero();
    for (let i = 0; i < 100; i += 1) total = total.plus(Money.fromEuros('0.1'));
    expect(total.toEuros()).toBe('10.00');
    expect(total.cents).toBe(1000);
  });

  it('arrastra precision completa en costes por gramo', () => {
    // 8,00 EUR por 10 000 g = 0,08 centimos/g. Redondear aqui daria 0.
    const perGram = Money.fromCents(800).dividedBy(10000);
    expect(perGram.exactCents.toString()).toBe('0.08');
    expect(perGram.times(1250).toEuros()).toBe('1.00');
  });

  it('suma, resta y multiplica', () => {
    const a = Money.fromCents(1000);
    expect(a.plus(Money.fromCents(235)).cents).toBe(1235);
    expect(a.minus(Money.fromCents(235)).cents).toBe(765);
    expect(a.times('1.21').cents).toBe(1210);
    expect(a.times(new Decimal(3)).cents).toBe(3000);
  });

  it('divide y protege de la division por cero', () => {
    expect(Money.fromCents(1000).dividedBy(3).exactCents.toFixed(4)).toBe('333.3333');
    expect(() => Money.fromCents(100).dividedBy(0)).toThrow(DivisionByZeroError);
    expect(() => Money.fromCents(100).dividedBy(0, 'el coste por racion')).toThrow(
      /el coste por racion/,
    );
  });

  it('rechaza factores y divisores no finitos', () => {
    expect(() => Money.fromCents(100).times(Number.NaN)).toThrow(InvalidValueError);
    expect(() => Money.fromCents(100).dividedBy(Number.POSITIVE_INFINITY)).toThrow(
      InvalidValueError,
    );
  });

  it('calcula razones y protege del denominador cero', () => {
    expect(Money.fromCents(280).ratioTo(Money.fromCents(1000)).toString()).toBe('0.28');
    expect(() => Money.fromCents(100).ratioTo(Money.zero())).toThrow(DivisionByZeroError);
    expect(() => Money.fromCents(100).ratioTo(Money.zero(), 'el food cost')).toThrow(/food cost/);
  });
});

describe('Money — redondeo y comparacion', () => {
  it('redondea una sola vez, al final', () => {
    const exact = Money.fromExactCents('86.2962962962');
    expect(exact.cents).toBe(86);
    expect(exact.round().exactCents.toString()).toBe('86');
    expect(exact.toEuros()).toBe('0.86');
  });

  it('redondea medio hacia arriba', () => {
    expect(Money.fromExactCents('0.5').cents).toBe(1);
    expect(Money.fromExactCents('1.5').cents).toBe(2);
  });

  it('compara importes', () => {
    const a = Money.fromCents(100);
    const b = Money.fromCents(200);
    expect(a.lessThan(b)).toBe(true);
    expect(b.greaterThan(a)).toBe(true);
    expect(a.equals(Money.fromCents(100))).toBe(true);
    expect(a.isPositive()).toBe(true);
    expect(a.isNegative()).toBe(false);
    expect(Money.zero().isPositive()).toBe(false);
    expect(Money.fromCents(-1).isNegative()).toBe(true);
  });

  it('se presenta en castellano y se serializa sin perder el entero', () => {
    expect(Money.fromCents(1235).toString()).toBe('12,35 EUR');
    expect(Money.fromCents(1235).toJSON()).toEqual({ cents: 1235, euros: '12.35' });
  });
});

describe('Money — reparto sin perder centimos', () => {
  it('reparte 100 centimos entre tres partes iguales sin perder ninguno', () => {
    const parts = Money.fromCents(100).allocate([1, 1, 1]);
    expect(parts.map((p) => p.cents)).toEqual([34, 33, 33]);
    expect(Money.sum(parts).cents).toBe(100);
  });

  it('respeta proporciones desiguales', () => {
    const parts = Money.fromCents(1000).allocate(['0.7', '0.3']);
    expect(parts.map((p) => p.cents)).toEqual([700, 300]);
  });

  it('asigna los restos de forma determinista al mayor resto', () => {
    const parts = Money.fromCents(10).allocate([1, 1, 1, 1, 1, 1]);
    expect(Money.sum(parts).cents).toBe(10);
    expect(parts.map((p) => p.cents)).toEqual([2, 2, 2, 2, 1, 1]);
  });

  it('da el centimo sobrante a la parte con mayor resto, no a la primera', () => {
    // 100 centimos en 1:2:4 -> 14,2857 / 28,5714 / 57,1428. El mayor resto es
    // el del medio, asi que es el que se lleva el centimo que falta.
    const parts = Money.fromCents(100).allocate([1, 2, 4]);
    expect(parts.map((p) => p.cents)).toEqual([14, 29, 57]);
    expect(Money.sum(parts).cents).toBe(100);
  });

  it('reparte un importe exacto sin restos', () => {
    const parts = Money.fromCents(9).allocate([1, 1, 1]);
    expect(parts.map((p) => p.cents)).toEqual([3, 3, 3]);
  });

  it('reparte a una sola parte', () => {
    expect(
      Money.fromCents(999)
        .allocate([1])
        .map((p) => p.cents),
    ).toEqual([999]);
  });

  it('rechaza repartos invalidos', () => {
    expect(() => Money.fromCents(100).allocate([])).toThrow(InvalidValueError);
    expect(() => Money.fromCents(100).allocate([1, -1])).toThrow(InvalidValueError);
    expect(() => Money.fromCents(100).allocate([Number.NaN])).toThrow(InvalidValueError);
    expect(() => Money.fromCents(100).allocate([0, 0])).toThrow(DivisionByZeroError);
  });
});

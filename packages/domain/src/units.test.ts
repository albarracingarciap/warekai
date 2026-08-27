import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.js';
import { InvalidValueError } from './errors.js';
import {
  ALL_UNITS,
  CANONICAL_UNIT,
  Quantity,
  dimensionOf,
  factorToCanonical,
  isUnit,
  unitDefinition,
  unitLabel,
} from './units.js';

describe('unidades', () => {
  it('clasifica cada unidad en su dimension', () => {
    expect(dimensionOf('g')).toBe('MASS');
    expect(dimensionOf('kg')).toBe('MASS');
    expect(dimensionOf('ml')).toBe('VOLUME');
    expect(dimensionOf('cl')).toBe('VOLUME');
    expect(dimensionOf('l')).toBe('VOLUME');
    expect(dimensionOf('ud')).toBe('COUNT');
  });

  it('expone factores a la unidad canonica', () => {
    expect(factorToCanonical('kg').toString()).toBe('1000');
    expect(factorToCanonical('cl').toString()).toBe('10');
    expect(factorToCanonical('ud').toString()).toBe('1');
  });

  it('la canonica de cada dimension tiene factor 1', () => {
    for (const unit of Object.values(CANONICAL_UNIT)) {
      expect(factorToCanonical(unit).toString()).toBe('1');
    }
  });

  it('reconoce unidades validas', () => {
    expect(isUnit('g')).toBe(true);
    expect(isUnit('litros')).toBe(false);
    expect(isUnit('toString')).toBe(false);
  });

  it('describe cada unidad', () => {
    expect(unitLabel('ud')).toBe('unidad');
    expect(unitDefinition('l').dimension).toBe('VOLUME');
    expect(ALL_UNITS).toHaveLength(6);
  });
});

describe('Quantity', () => {
  it('se construye desde cadena, numero y Decimal', () => {
    expect(Quantity.of('1.5', 'kg').toString()).toBe('1.5 kg');
    expect(Quantity.of(200, 'g').amount.toString()).toBe('200');
    expect(Quantity.of(new Decimal('0.5'), 'l').amount.toString()).toBe('0.5');
  });

  it('rechaza cantidades negativas o no finitas', () => {
    expect(() => Quantity.of('-1', 'g')).toThrow(InvalidValueError);
    expect(() => Quantity.of(Number.NaN, 'g')).toThrow(InvalidValueError);
  });

  it('conoce su dimension y si es cero', () => {
    expect(Quantity.of('1', 'ml').dimension).toBe('VOLUME');
    expect(Quantity.zero('g').isZero()).toBe(true);
    expect(Quantity.of('1', 'g').isZero()).toBe(false);
  });

  it('suma y resta con la misma unidad', () => {
    const a = Quantity.of('200', 'g');
    expect(a.plus(Quantity.of('50', 'g')).amount.toString()).toBe('250');
    expect(a.minus(Quantity.of('50', 'g')).amount.toString()).toBe('150');
  });

  it('se niega a operar entre unidades distintas', () => {
    const a = Quantity.of('200', 'g');
    expect(() => a.plus(Quantity.of('1', 'kg'))).toThrow(/misma unidad/);
    expect(() => a.minus(Quantity.of('1', 'kg'))).toThrow(InvalidValueError);
    expect(() => a.ratioTo(Quantity.of('1', 'kg'))).toThrow(InvalidValueError);
  });

  it('multiplica y divide', () => {
    const a = Quantity.of('200', 'g');
    expect(a.times('3').amount.toString()).toBe('600');
    expect(a.dividedBy('0.4').amount.toString()).toBe('500');
    expect(() => a.dividedBy(0)).toThrow(InvalidValueError);
  });

  it('calcula razones adimensionales', () => {
    expect(Quantity.of('200', 'ml').ratioTo(Quantity.of('400', 'ml')).toString()).toBe('0.5');
    expect(() => Quantity.of('1', 'ml').ratioTo(Quantity.zero('ml'))).toThrow(InvalidValueError);
  });

  it('compara y se serializa', () => {
    expect(Quantity.of('1', 'g').equals(Quantity.of('1', 'g'))).toBe(true);
    expect(Quantity.of('1', 'g').equals(Quantity.of('1', 'kg'))).toBe(false);
    expect(Quantity.of('1', 'g').equals(Quantity.of('2', 'g'))).toBe(false);
    expect(Quantity.of('1.5', 'kg').toJSON()).toEqual({ amount: '1.5', unit: 'kg' });
  });
});

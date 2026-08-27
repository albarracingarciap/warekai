import { describe, expect, it } from 'vitest';
import { convert, costPerUsageUnit, toUsageUnit, usageUnitsPerPurchaseUnit } from './conversion.js';
import { Decimal } from './decimal.js';
import { InvalidValueError, MissingConversionFactorError } from './errors.js';
import { Money } from './money.js';
import { Quantity } from './units.js';
import { ACEITE, CEBOLLA, item, q } from './__fixtures__/kitchen.js';

const ACEITE_BRIDGES = { densityGPerMl: new Decimal('0.916') };
const CEBOLLA_BRIDGES = { weightPerPieceG: new Decimal('150') };
const AMBOS = { ...ACEITE_BRIDGES, ...CEBOLLA_BRIDGES };

describe('conversion dentro de la misma dimension', () => {
  it('devuelve la misma cantidad si la unidad no cambia', () => {
    const original = q('200', 'g');
    expect(convert(original, 'g')).toBe(original);
  });

  it('convierte masa', () => {
    expect(convert(q('1.5', 'kg'), 'g').toString()).toBe('1500 g');
    expect(convert(q('250', 'g'), 'kg').toString()).toBe('0.25 kg');
  });

  it('convierte volumen', () => {
    expect(convert(q('1', 'l'), 'ml').toString()).toBe('1000 ml');
    expect(convert(q('75', 'cl'), 'ml').toString()).toBe('750 ml');
    expect(convert(q('1500', 'ml'), 'l').toString()).toBe('1.5 l');
  });
});

describe('puentes entre dimensiones', () => {
  it('volumen a masa con densidad: un chorro de aceite', () => {
    expect(convert(q('100', 'ml'), 'g', ACEITE_BRIDGES).toString()).toBe('91.6 g');
    expect(convert(q('1', 'l'), 'kg', ACEITE_BRIDGES).toString()).toBe('0.916 kg');
  });

  it('masa a volumen con densidad', () => {
    expect(convert(q('91.6', 'g'), 'ml', ACEITE_BRIDGES).toString()).toBe('100 ml');
  });

  it('piezas a masa con peso por pieza', () => {
    expect(convert(q('2', 'ud'), 'g', CEBOLLA_BRIDGES).toString()).toBe('300 g');
  });

  it('masa a piezas: media cebolla', () => {
    expect(convert(q('75', 'g'), 'ud', CEBOLLA_BRIDGES).toString()).toBe('0.5 ud');
  });

  it('encadena los dos puentes de piezas a volumen y al reves', () => {
    // 1 pieza = 150 g; 150 g / 0,916 g/ml = 163,7554... ml
    expect(convert(q('1', 'ud'), 'ml', AMBOS).amount.toFixed(4)).toBe('163.7555');
    expect(
      convert(q('163.7554585152838427947598253275', 'ml'), 'ud', AMBOS).amount.toFixed(6),
    ).toBe('1.000000');
  });

  it('exige el factor que falta y lo dice', () => {
    expect(() => convert(q('100', 'ml'), 'g')).toThrow(MissingConversionFactorError);
    expect(() => convert(q('100', 'g'), 'ml', {}, 'aceite')).toThrow(
      /densidad.*en el item aceite/s,
    );
    expect(() => convert(q('1', 'ud'), 'g')).toThrow(/peso por pieza/);
    expect(() => convert(q('1', 'g'), 'ud')).toThrow(/peso por pieza/);
    expect(() => convert(q('1', 'ud'), 'ml', CEBOLLA_BRIDGES)).toThrow(/densidad/);
    expect(() => convert(q('1', 'ml'), 'ud', ACEITE_BRIDGES)).toThrow(/peso por pieza/);
  });

  it('rechaza factores no positivos', () => {
    expect(() => convert(q('1', 'ml'), 'g', { densityGPerMl: new Decimal(0) })).toThrow(
      InvalidValueError,
    );
    expect(() => convert(q('1', 'ud'), 'g', { weightPerPieceG: new Decimal(-5) })).toThrow(
      InvalidValueError,
    );
  });
});

describe('triple unidad y coste por unidad de uso', () => {
  it('una caja de 6 botellas de 700 ml rinde 4200 ml', () => {
    expect(usageUnitsPerPurchaseUnit(ACEITE.units).toString()).toBe('4200');
  });

  it('reparte el precio de la caja entre las unidades de uso', () => {
    // 42,00 EUR / 4200 ml = 1 centimo por ml
    expect(costPerUsageUnit(Money.fromCents(4200), ACEITE.units).exactCents.toString()).toBe('1');
    // 8,00 EUR / 10 000 g = 0,08 centimos por gramo
    expect(costPerUsageUnit(Money.fromCents(800), CEBOLLA.units).exactCents.toString()).toBe(
      '0.08',
    );
  });

  it('rechaza factores de empaquetado invalidos', () => {
    const roto = item({
      id: 'roto',
      name: 'Item con factor cero',
      usageUnit: 'g',
      stockToUsage: '0',
    });
    expect(() => usageUnitsPerPurchaseUnit(roto.units)).toThrow(InvalidValueError);
  });

  it('toUsageUnit usa los puentes del propio item', () => {
    expect(toUsageUnit(Quantity.of('2', 'ud'), CEBOLLA).toString()).toBe('300 g');
    expect(toUsageUnit(Quantity.of('1', 'l'), ACEITE).toString()).toBe('1000 ml');
  });
});

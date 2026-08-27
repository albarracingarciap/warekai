import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.js';
import { InvalidYieldError } from './errors.js';
import { Money } from './money.js';
import { Quantity } from './units.js';
import {
  assertYieldFactor,
  chainYields,
  grossFromNet,
  netFromGross,
  netOutput,
  outputCostPerUnit,
} from './yield.js';

const d = (v: string): Decimal => new Decimal(v);

describe('validacion del factor de merma', () => {
  it('acepta el rango (0, 1]', () => {
    expect(assertYieldFactor(d('1'), 'limpieza').toString()).toBe('1');
    expect(assertYieldFactor(d('0.4'), 'proceso').toString()).toBe('0.4');
    expect(assertYieldFactor(d('0.0001'), 'limpieza').toString()).toBe('0.0001');
  });

  it('rechaza el error clasico de escribir 40 en vez de 0.4', () => {
    expect(() => assertYieldFactor(d('40'), 'limpieza')).toThrow(InvalidYieldError);
    expect(() => assertYieldFactor(d('40'), 'limpieza')).toThrow(/0\.4/);
  });

  it('rechaza cero, negativos y no finitos', () => {
    expect(() => assertYieldFactor(d('0'), 'proceso')).toThrow(InvalidYieldError);
    expect(() => assertYieldFactor(d('-0.5'), 'proceso')).toThrow(InvalidYieldError);
    expect(() => assertYieldFactor(new Decimal(Number.NaN), 'proceso')).toThrow(InvalidYieldError);
  });
});

describe('merma de limpieza', () => {
  it('200 g de alcachofa limpia exigen 500 g de compra', () => {
    expect(grossFromNet(Quantity.of('200', 'g'), d('0.4')).toString()).toBe('500 g');
  });

  it('un rendimiento de 1 no cambia nada', () => {
    expect(grossFromNet(Quantity.of('100', 'ml'), d('1')).toString()).toBe('100 ml');
  });

  it('la direccion inversa dice cuanto queda utilizable', () => {
    expect(netFromGross(Quantity.of('500', 'g'), d('0.4')).toString()).toBe('200 g');
  });

  it('ida y vuelta es la identidad', () => {
    const original = Quantity.of('333', 'g');
    expect(netFromGross(grossFromNet(original, d('0.37')), d('0.37')).amount.toFixed(10)).toBe(
      '333.0000000000',
    );
  });

  it('propaga el error de factor invalido', () => {
    expect(() => grossFromNet(Quantity.of('1', 'g'), d('0'))).toThrow(InvalidYieldError);
    expect(() => netFromGross(Quantity.of('1', 'g'), d('2'))).toThrow(InvalidYieldError);
  });
});

describe('merma de proceso', () => {
  it('10 l de ingredientes al 40 % dan 4 l de fondo', () => {
    expect(netOutput(Quantity.of('10', 'l'), d('0.4')).toString()).toBe('4 l');
  });

  it('el coste por litro sube en la misma proporcion en que se reduce', () => {
    // 30,00 EUR de ingredientes, 10 000 ml de partida, rendimiento 0,4 -> 4000 ml
    const perMl = outputCostPerUnit(Money.fromCents(3000), Quantity.of('10000', 'ml'), d('0.4'));
    expect(perMl.exactCents.toString()).toBe('0.75');
    // Sin merma serian 0,30 centimos/ml: exactamente 2,5 veces menos.
    const sinMerma = outputCostPerUnit(Money.fromCents(3000), Quantity.of('10000', 'ml'), d('1'));
    expect(perMl.exactCents.dividedBy(sinMerma.exactCents).toString()).toBe('2.5');
  });

  it('una salida nula no rompe el calculo', () => {
    expect(outputCostPerUnit(Money.fromCents(100), Quantity.zero('ml'), d('1')).isZero()).toBe(
      true,
    );
  });

  it('valida el factor', () => {
    expect(() => netOutput(Quantity.of('1', 'l'), d('1.2'))).toThrow(InvalidYieldError);
  });
});

describe('encadenado de mermas', () => {
  it('multiplica los factores en cadena', () => {
    expect(chainYields([d('0.4'), d('0.4')]).toString()).toBe('0.16');
    expect(chainYields([d('0.4'), d('0.5'), d('0.5')]).toString()).toBe('0.1');
  });

  it('la cadena vacia es la identidad', () => {
    expect(chainYields([]).toString()).toBe('1');
  });

  it('valida cada eslabon, con el tipo de merma indicado', () => {
    expect(() => chainYields([d('0.4'), d('0')], 'limpieza')).toThrow(/limpieza/);
    expect(() => chainYields([d('3')])).toThrow(/proceso/);
  });
});

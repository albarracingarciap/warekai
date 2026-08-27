import { describe, expect, it } from 'vitest';
import { Decimal, HUNDRED, ONE, ZERO, dec } from './decimal.js';

describe('configuracion decimal', () => {
  it('mantiene precision suficiente para cadenas largas de mermas', () => {
    // 1/3 repetido nueve veces: con coma flotante el error ya seria visible.
    let value = new Decimal(1);
    for (let i = 0; i < 9; i += 1) value = value.dividedBy(3);
    expect(value.times(new Decimal(3).pow(9)).toString()).toBe('1');
  });

  it('no usa notacion exponencial para costes por gramo diminutos', () => {
    expect(new Decimal('0.0000123').toString()).toBe('0.0000123');
  });

  it('redondea medio hacia arriba, como un escandallo a mano', () => {
    expect(new Decimal('2.5').toDecimalPlaces(0).toString()).toBe('3');
    expect(new Decimal('3.5').toDecimalPlaces(0).toString()).toBe('4');
  });

  it('no altera la configuracion global de decimal.js', async () => {
    const { default: Global } = await import('decimal.js');
    expect(Global.precision).toBe(20);
    expect(Decimal.precision).toBe(34);
  });

  it('expone constantes', () => {
    expect(ZERO.toString()).toBe('0');
    expect(ONE.toString()).toBe('1');
    expect(HUNDRED.toString()).toBe('100');
  });
});

describe('dec', () => {
  it('devuelve la misma instancia si ya es Decimal', () => {
    const value = new Decimal('1.5');
    expect(dec(value)).toBe(value);
  });

  it('convierte desde cadena y desde numero', () => {
    expect(dec('1.5').toString()).toBe('1.5');
    expect(dec(2).toString()).toBe('2');
  });
});

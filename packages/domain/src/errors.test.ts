import { describe, expect, it } from 'vitest';
import {
  CyclicRecipeError,
  DivisionByZeroError,
  DomainError,
  IncompatibleUnitsError,
  InvalidValueError,
  InvalidYieldError,
  MissingConversionFactorError,
  MissingPurchasePriceError,
  UnknownItemError,
  UnknownRecipeError,
} from './errors.js';

describe('errores del dominio', () => {
  it('todos heredan de DomainError y llevan codigo estable', () => {
    const errors: DomainError[] = [
      new IncompatibleUnitsError('g', 'ml', 'falta densidad'),
      new MissingConversionFactorError('densidad', 'aceite'),
      new InvalidYieldError('limpieza', '40'),
      new CyclicRecipeError(['a', 'b', 'a']),
      new UnknownItemError('fantasma'),
      new UnknownRecipeError('fantasma'),
      new DivisionByZeroError('el food cost'),
      new InvalidValueError('raciones', '0', 'un entero positivo'),
      new MissingPurchasePriceError('alcachofa'),
    ];
    const codes = errors.map((e) => e.code);
    expect(new Set(codes).size).toBe(errors.length);
    for (const error of errors) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(error.constructor.name);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('el error de factor omite el item cuando no se conoce', () => {
    expect(new MissingConversionFactorError('peso por pieza').message).not.toContain('en el item');
    expect(new MissingConversionFactorError('peso por pieza', 'cebolla').message).toContain(
      'en el item cebolla',
    );
  });

  it('el error de ciclo describe la ruta completa', () => {
    const error = new CyclicRecipeError(['salsa', 'fondo', 'salsa']);
    expect(error.message).toContain('salsa -> fondo -> salsa');
    expect(error.cycle).toEqual(['salsa', 'fondo', 'salsa']);
  });

  it('el error de merma recuerda que 40 % se escribe 0.4', () => {
    expect(new InvalidYieldError('proceso', '40').message).toContain('0.4');
  });
});

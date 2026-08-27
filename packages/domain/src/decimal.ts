import DecimalJs from 'decimal.js';
import { InvalidValueError } from './errors.js';

/**
 * Clon local de Decimal con la configuracion del dominio.
 *
 * Se clona en lugar de configurar el Decimal global para no alterar el
 * comportamiento de decimal.js en el resto de la aplicacion ni en las
 * dependencias que pudieran usarlo.
 *
 * - `precision: 34` deja margen holgado para cadenas largas de elaboraciones
 *   anidadas, donde cada nivel introduce una division no exacta (mermas del
 *   tipo 1/3, rendimientos del 0,4166..., etc.).
 * - `ROUND_HALF_UP` es el redondeo comercial habitual en Espana y el que
 *   espera cualquiera que revise un escandallo a mano.
 * - `toExpNeg`/`toExpPos` muy separados para que `toString()` nunca devuelva
 *   notacion exponencial: un coste por gramo de 0,0000123 EUR debe leerse
 *   como tal y no como `1.23e-5`.
 */
export const Decimal = DecimalJs.clone({
  precision: 34,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export type Decimal = InstanceType<typeof Decimal>;

/** Cualquier cosa que se pueda convertir a Decimal sin pasar por coma flotante. */
export type DecimalInput = Decimal | string | number;

export const ZERO: Decimal = new Decimal(0);
export const ONE: Decimal = new Decimal(1);
export const HUNDRED: Decimal = new Decimal(100);

/** Normaliza una entrada a Decimal. */
export function dec(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/**
 * Como `dec`, pero traduce el `DecimalError` de decimal.js a un error del
 * dominio con el nombre del campo. Se usa en todas las fronteras por las que
 * entra un dato de fuera: lo que llega de un formulario o de la API puede ser
 * cualquier cosa, y el mensaje debe decir que campo esta mal.
 */
export function decOrThrow(value: DecimalInput, field: string): Decimal {
  try {
    return dec(value);
  } catch {
    throw new InvalidValueError(field, String(value), 'un numero valido');
  }
}

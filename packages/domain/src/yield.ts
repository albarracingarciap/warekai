import { type Decimal, ONE } from './decimal.js';
import { InvalidYieldError } from './errors.js';
import { Money } from './money.js';
import { type Quantity } from './units.js';

export type YieldKind = 'limpieza' | 'proceso';

/**
 * Valida un factor de merma. El rango valido es (0, 1]:
 *  - `1` significa sin perdida.
 *  - `0.4` significa que queda el 40 %.
 *  - `0` seria una perdida total, y `> 1` una ganancia de materia, que no
 *    existe: si un producto gana peso al cocerse (arroz, legumbre) eso se
 *    modela con la cantidad de salida de la receta, no con un rendimiento
 *    mayor que uno.
 *
 * El error mas comun es escribir `40` en vez de `0.4`, o el complementario
 * `0.6` en vez del rendimiento `0.4`. Por eso el mensaje lo dice explicito.
 */
export function assertYieldFactor(value: Decimal, kind: YieldKind): Decimal {
  if (!value.isFinite() || !value.greaterThan(0) || value.greaterThan(1)) {
    throw new InvalidYieldError(kind, value.toString());
  }
  return value;
}

/**
 * Merma de limpieza, en la direccion que importa para el escandallo.
 *
 * La receta declara el peso NETO, ya limpio. Lo que hay que comprar es mas:
 * 200 g de alcachofa limpia con un rendimiento del 40 % exigen 500 g de
 * alcachofa entera en camara.
 */
export function grossFromNet(net: Quantity, cleaningYield: Decimal): Quantity {
  return net.dividedBy(assertYieldFactor(cleaningYield, 'limpieza'));
}

/** Direccion inversa: cuanto queda utilizable de un peso bruto conocido. */
export function netFromGross(gross: Quantity, cleaningYield: Decimal): Quantity {
  return gross.times(assertYieldFactor(cleaningYield, 'limpieza'));
}

/**
 * Salida real de una elaboracion tras la merma de proceso.
 * 10 L de ingredientes con un rendimiento de 0,4 dan 4 L de fondo.
 */
export function netOutput(outputQuantity: Quantity, yieldFactor: Decimal): Quantity {
  return outputQuantity.times(assertYieldFactor(yieldFactor, 'proceso'));
}

/**
 * Coste de una unidad de salida de una elaboracion.
 *
 * Aqui es donde la merma de proceso se convierte en dinero: el coste de los
 * ingredientes no cambia al reducir, pero se reparte entre menos producto, asi
 * que el coste por litro sube en la misma proporcion.
 */
export function outputCostPerUnit(
  inputCost: Money,
  outputQuantity: Quantity,
  yieldFactor: Decimal,
): Money {
  const real = netOutput(outputQuantity, yieldFactor);
  if (real.isZero()) {
    return Money.zero();
  }
  return inputCost.dividedBy(real.amount, 'el coste por unidad de salida de la elaboracion');
}

/**
 * Encadena varios factores de merma en uno solo.
 *
 * Es la operacion que ocurre implicitamente a lo largo de una cadena de
 * elaboraciones anidadas; se expone aparte para poder mostrarla en la ficha
 * tecnica y para poder testearla de forma aislada.
 */
export function chainYields(factors: readonly Decimal[], kind: YieldKind = 'proceso'): Decimal {
  return factors.reduce<Decimal>((acc, f) => acc.times(assertYieldFactor(f, kind)), ONE);
}

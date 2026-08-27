import { Decimal, decOrThrow, type DecimalInput } from './decimal.js';
import { DivisionByZeroError, InvalidValueError } from './errors.js';

/**
 * Importe monetario con aritmetica decimal exacta.
 *
 * Internamente guarda **centimos** en un `Decimal`, no en un `number`. En
 * ningun punto del motor se usa coma flotante para dinero.
 *
 * Los centimos pueden ser fraccionarios de forma intencionada. El coste de un
 * gramo de perejil es una fraccion minuscula de centimo, y redondear en cada
 * linea de un escandallo de cuarenta ingredientes anidados a tres niveles
 * introduce un error que se nota en el margen. La regla es: se arrastra
 * precision completa durante todo el calculo y se redondea **una sola vez**,
 * al presentar o al persistir, con `round()` o con el getter `cents`.
 */
export class Money {
  private constructor(private readonly value: Decimal) {}

  /** Construye desde un numero entero de centimos. */
  static fromCents(cents: number | string | Decimal): Money {
    const value = decOrThrow(cents, 'importe');
    if (!value.isFinite()) {
      throw new InvalidValueError('importe', String(cents), 'un numero finito');
    }
    if (!value.isInteger()) {
      throw new InvalidValueError(
        'centimos',
        value.toString(),
        'un numero entero de centimos (usa `fromExactCents` para precision fraccionaria)',
      );
    }
    return new Money(value);
  }

  /**
   * Construye desde centimos posiblemente fraccionarios. Es la via que usa el
   * motor internamente para costes unitarios.
   */
  static fromExactCents(cents: DecimalInput): Money {
    const value = decOrThrow(cents, 'importe');
    if (!value.isFinite()) {
      throw new InvalidValueError('importe', String(cents), 'un numero finito');
    }
    return new Money(value);
  }

  /**
   * Construye desde euros expresados como cadena: `Money.fromEuros('12.35')`.
   *
   * Solo acepta cadena o Decimal. No acepta `number` a proposito: aceptarlo
   * seria abrir la puerta a que un `0.1 + 0.2` se cuele en un importe.
   */
  static fromEuros(euros: string | Decimal): Money {
    const value = decOrThrow(euros, 'importe en euros');
    if (!value.isFinite()) {
      throw new InvalidValueError('importe en euros', String(euros), 'un numero finito');
    }
    return new Money(value.times(100));
  }

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  /** Suma de una lista, con cero como elemento neutro. */
  static sum(amounts: readonly Money[]): Money {
    return amounts.reduce<Money>((acc, m) => acc.plus(m), Money.zero());
  }

  /** Centimos con precision completa, sin redondear. */
  get exactCents(): Decimal {
    return this.value;
  }

  /** Centimos redondeados a entero (medio hacia arriba). Valor de presentacion. */
  get cents(): number {
    return this.value.toDecimalPlaces(0).toNumber();
  }

  plus(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  minus(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  times(factor: DecimalInput): Money {
    const f = decOrThrow(factor, 'factor');
    if (!f.isFinite()) {
      throw new InvalidValueError('factor', String(factor), 'un numero finito');
    }
    return new Money(this.value.times(f));
  }

  dividedBy(divisor: DecimalInput, context = 'un importe'): Money {
    const d = decOrThrow(divisor, 'divisor');
    if (d.isZero()) {
      throw new DivisionByZeroError(context);
    }
    if (!d.isFinite()) {
      throw new InvalidValueError('divisor', String(divisor), 'un numero finito');
    }
    return new Money(this.value.dividedBy(d));
  }

  /** Razon adimensional entre dos importes. Base del food cost porcentual. */
  ratioTo(other: Money, context = 'un porcentaje'): Decimal {
    if (other.value.isZero()) {
      throw new DivisionByZeroError(context);
    }
    return this.value.dividedBy(other.value);
  }

  /** Snapshot a centimos enteros. Es el unico punto donde se pierde precision. */
  round(): Money {
    return new Money(this.value.toDecimalPlaces(0));
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  equals(other: Money): boolean {
    return this.value.equals(other.value);
  }

  greaterThan(other: Money): boolean {
    return this.value.greaterThan(other.value);
  }

  lessThan(other: Money): boolean {
    return this.value.lessThan(other.value);
  }

  /**
   * Reparte el importe en partes proporcionales a `ratios` **sin perder ni un
   * centimo**: los centimos sobrantes del redondeo se asignan uno a uno a las
   * partes con mayor resto (metodo del resto mayor).
   *
   * Se usa para prorratear el coste de un lote entre raciones.
   */
  allocate(ratios: readonly DecimalInput[]): Money[] {
    if (ratios.length === 0) {
      throw new InvalidValueError('reparto', '[]', 'al menos una proporcion');
    }
    const weights = ratios.map((r) => decOrThrow(r, 'proporcion de reparto'));
    if (weights.some((w) => w.isNegative() || !w.isFinite())) {
      throw new InvalidValueError(
        'reparto',
        weights.map((w) => w.toString()).join(', '),
        'proporciones finitas y no negativas',
      );
    }
    const totalWeight = weights.reduce((a, b) => a.plus(b), new Decimal(0));
    if (totalWeight.isZero()) {
      throw new DivisionByZeroError('un reparto con proporciones que suman cero');
    }

    const totalCents = this.value.toDecimalPlaces(0);
    const exact = weights.map((w) => totalCents.times(w).dividedBy(totalWeight));
    const floors = exact.map((e) => e.floor());
    const assigned = floors.reduce((a, b) => a.plus(b), new Decimal(0));
    let remainder = totalCents.minus(assigned).toNumber();

    // Indices ordenados por resto decreciente; a igualdad de resto, el de menor
    // indice primero, para que el reparto sea determinista.
    const order = exact
      .map((e, index) => ({ index, fraction: e.minus(floors[index] as Decimal) }))
      .sort((a, b) => {
        const cmp = b.fraction.comparedTo(a.fraction);
        return cmp !== 0 ? cmp : a.index - b.index;
      });

    const result = floors.map((f) => new Money(f));
    for (const { index } of order) {
      if (remainder <= 0) break;
      result[index] = new Money((floors[index] as Decimal).plus(1));
      remainder -= 1;
    }
    return result;
  }

  /** Euros como cadena con dos decimales: `'12.35'`. */
  toEuros(): string {
    return this.value.dividedBy(100).toFixed(2);
  }

  /** Formato de presentacion en castellano: `'12,35 EUR'`. */
  toString(): string {
    return `${this.toEuros().replace('.', ',')} EUR`;
  }

  toJSON(): { cents: number; euros: string } {
    return { cents: this.cents, euros: this.toEuros() };
  }
}

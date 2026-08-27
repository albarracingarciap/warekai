import { Decimal, dec, decOrThrow, type DecimalInput } from './decimal.js';
import { InvalidValueError } from './errors.js';

/** Las tres magnitudes fisicas con las que trabaja una cocina. */
export type Dimension = 'MASS' | 'VOLUME' | 'COUNT';

/**
 * Unidades fisicas de uso en receta.
 *
 * No incluye unidades de empaquetado (caja, botella, bandeja): esas son
 * etiquetas por item con su factor asociado, no unidades del sistema. Ver
 * `ItemUnits` en `types.ts`.
 */
export type Unit = 'g' | 'kg' | 'ml' | 'cl' | 'l' | 'ud';

interface UnitDefinition {
  readonly dimension: Dimension;
  /** Cuantas unidades canonicas de su dimension vale una unidad de esta. */
  readonly toCanonical: string;
  readonly label: string;
}

const UNIT_DEFINITIONS = {
  g: { dimension: 'MASS', toCanonical: '1', label: 'gramo' },
  kg: { dimension: 'MASS', toCanonical: '1000', label: 'kilogramo' },
  ml: { dimension: 'VOLUME', toCanonical: '1', label: 'mililitro' },
  cl: { dimension: 'VOLUME', toCanonical: '10', label: 'centilitro' },
  l: { dimension: 'VOLUME', toCanonical: '1000', label: 'litro' },
  ud: { dimension: 'COUNT', toCanonical: '1', label: 'unidad' },
} as const satisfies Record<Unit, UnitDefinition>;

export const ALL_UNITS: readonly Unit[] = Object.keys(UNIT_DEFINITIONS) as Unit[];

/** Unidad canonica de cada dimension. Toda conversion pasa por ella. */
export const CANONICAL_UNIT: Record<Dimension, Unit> = {
  MASS: 'g',
  VOLUME: 'ml',
  COUNT: 'ud',
};

export function isUnit(value: string): value is Unit {
  return Object.prototype.hasOwnProperty.call(UNIT_DEFINITIONS, value);
}

export function unitDefinition(unit: Unit): UnitDefinition {
  return UNIT_DEFINITIONS[unit];
}

export function dimensionOf(unit: Unit): Dimension {
  return UNIT_DEFINITIONS[unit].dimension;
}

export function unitLabel(unit: Unit): string {
  return UNIT_DEFINITIONS[unit].label;
}

/** Factor para pasar de `unit` a la unidad canonica de su dimension. */
export function factorToCanonical(unit: Unit): Decimal {
  return new Decimal(UNIT_DEFINITIONS[unit].toCanonical);
}

/**
 * Una cantidad: importe decimal exacto + unidad.
 *
 * Inmutable. Toda operacion devuelve una instancia nueva.
 */
export class Quantity {
  private constructor(
    readonly amount: Decimal,
    readonly unit: Unit,
  ) {}

  static of(amount: DecimalInput, unit: Unit): Quantity {
    const value = decOrThrow(amount, 'cantidad');
    if (!value.isFinite()) {
      throw new InvalidValueError('cantidad', String(amount), 'un numero finito');
    }
    if (value.isNegative()) {
      throw new InvalidValueError('cantidad', value.toString(), 'un valor no negativo');
    }
    return new Quantity(value, unit);
  }

  static zero(unit: Unit): Quantity {
    return new Quantity(new Decimal(0), unit);
  }

  get dimension(): Dimension {
    return dimensionOf(this.unit);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  /** Suma con otra cantidad. Exige la misma unidad; convierte antes si hace falta. */
  plus(other: Quantity): Quantity {
    this.assertSameUnit(other, 'sumar');
    return new Quantity(this.amount.plus(other.amount), this.unit);
  }

  minus(other: Quantity): Quantity {
    this.assertSameUnit(other, 'restar');
    return Quantity.of(this.amount.minus(other.amount), this.unit);
  }

  times(factor: DecimalInput): Quantity {
    return Quantity.of(this.amount.times(dec(factor)), this.unit);
  }

  dividedBy(divisor: DecimalInput): Quantity {
    const d = dec(divisor);
    if (d.isZero()) {
      throw new InvalidValueError('divisor', '0', 'un valor distinto de cero');
    }
    return Quantity.of(this.amount.dividedBy(d), this.unit);
  }

  /** Razon adimensional entre dos cantidades de la misma unidad. */
  ratioTo(other: Quantity): Decimal {
    this.assertSameUnit(other, 'comparar');
    if (other.amount.isZero()) {
      throw new InvalidValueError('cantidad de referencia', '0', 'un valor distinto de cero');
    }
    return this.amount.dividedBy(other.amount);
  }

  equals(other: Quantity): boolean {
    return this.unit === other.unit && this.amount.equals(other.amount);
  }

  toString(): string {
    return `${this.amount.toString()} ${this.unit}`;
  }

  toJSON(): { amount: string; unit: Unit } {
    return { amount: this.amount.toString(), unit: this.unit };
  }

  private assertSameUnit(other: Quantity, action: string): void {
    if (this.unit !== other.unit) {
      throw new InvalidValueError(
        `unidad al ${action}`,
        `${this.unit} y ${other.unit}`,
        'la misma unidad en ambas cantidades (convierte antes con `convert`)',
      );
    }
  }
}

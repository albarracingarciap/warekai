/**
 * Errores del dominio.
 *
 * Todos llevan un `code` estable para que la API pueda traducirlos a una
 * respuesta HTTP sin inspeccionar el mensaje, y el frontend pueda mostrar un
 * texto propio. Los mensajes estan en castellano porque son los que acaba
 * leyendo el jefe de cocina en la interfaz.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Se ha intentado convertir entre dimensiones sin el puente necesario. */
export class IncompatibleUnitsError extends DomainError {
  readonly code = 'INCOMPATIBLE_UNITS';

  constructor(
    readonly from: string,
    readonly to: string,
    readonly reason: string,
  ) {
    super(`No se puede convertir de "${from}" a "${to}": ${reason}`);
  }
}

/** Falta densidad o peso por pieza para cruzar de una dimension a otra. */
export class MissingConversionFactorError extends DomainError {
  readonly code = 'MISSING_CONVERSION_FACTOR';

  constructor(
    readonly factor: 'densidad' | 'peso por pieza',
    readonly itemId?: string,
  ) {
    super(
      `Falta el factor de conversion "${factor}"${
        itemId ? ` en el item ${itemId}` : ''
      }. Sin el no se puede resolver la cantidad de la receta.`,
    );
  }
}

/** Un factor de merma fuera del rango valido (0, 1]. */
export class InvalidYieldError extends DomainError {
  readonly code = 'INVALID_YIELD';

  constructor(
    readonly kind: 'limpieza' | 'proceso',
    readonly value: string,
  ) {
    super(
      `El factor de merma de ${kind} debe estar en el rango (0, 1] y se ha recibido ${value}. ` +
        `Un 40 % de rendimiento se expresa como 0.4, no como 40 ni como 60.`,
    );
  }
}

/** El grafo de elaboraciones contiene un ciclo. */
export class CyclicRecipeError extends DomainError {
  readonly code = 'CYCLIC_RECIPE';

  constructor(readonly cycle: readonly string[]) {
    super(
      `Ciclo detectado en las elaboraciones anidadas: ${cycle.join(' -> ')}. ` +
        `Una elaboracion no puede contenerse a si misma, ni directa ni indirectamente.`,
    );
  }
}

/** Se ha referenciado un item que no esta en el catalogo. */
export class UnknownItemError extends DomainError {
  readonly code = 'UNKNOWN_ITEM';

  constructor(readonly itemId: string) {
    super(`El item ${itemId} no existe en el catalogo proporcionado.`);
  }
}

/** Se ha referenciado una receta que no existe. */
export class UnknownRecipeError extends DomainError {
  readonly code = 'UNKNOWN_RECIPE';

  constructor(readonly itemId: string) {
    super(`No hay receta para el item ${itemId}.`);
  }
}

/** Division por cero en aritmetica monetaria o de cantidades. */
export class DivisionByZeroError extends DomainError {
  readonly code = 'DIVISION_BY_ZERO';

  constructor(readonly context: string) {
    super(`Division por cero al calcular ${context}.`);
  }
}

/** Un valor numerico invalido para el contexto en que se usa. */
export class InvalidValueError extends DomainError {
  readonly code = 'INVALID_VALUE';

  constructor(
    readonly field: string,
    readonly value: string,
    readonly expectation: string,
  ) {
    super(`Valor invalido en "${field}": ${value}. Se esperaba ${expectation}.`);
  }
}

/** Un item de materia prima sin precio de compra no puede costearse. */
export class MissingPurchasePriceError extends DomainError {
  readonly code = 'MISSING_PURCHASE_PRICE';

  constructor(readonly itemId: string) {
    super(
      `El item ${itemId} no tiene precio de compra y no es una elaboracion, ` +
        `asi que no se puede calcular su coste.`,
    );
  }
}

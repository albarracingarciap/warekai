import { type Decimal } from './decimal.js';
import {
  IncompatibleUnitsError,
  InvalidValueError,
  MissingConversionFactorError,
} from './errors.js';
import { type Money } from './money.js';
import type { CatalogItem, ItemUnits } from './types.js';
import { CANONICAL_UNIT, dimensionOf, factorToCanonical, Quantity, type Unit } from './units.js';

/**
 * Los dos puentes que permiten cruzar de una dimension fisica a otra.
 * Sin ellos el sistema no sabe resolver "media cebolla" ni "un chorro de aceite".
 */
export interface ConversionBridges {
  readonly densityGPerMl?: Decimal;
  readonly weightPerPieceG?: Decimal;
}

function requirePositive(
  value: Decimal | undefined,
  factor: 'densidad' | 'peso por pieza',
  itemId?: string,
): Decimal {
  if (value === undefined) {
    throw new MissingConversionFactorError(factor, itemId);
  }
  if (!value.isFinite() || !value.greaterThan(0)) {
    throw new InvalidValueError(factor, value.toString(), 'un valor finito y mayor que cero');
  }
  return value;
}

/**
 * Convierte una cantidad a otra unidad, cruzando dimensiones cuando el item
 * aporta el puente necesario.
 *
 * Toda conversion pasa por la unidad canonica de la dimension (g, ml, ud), de
 * modo que solo hay que definir los puentes entre canonicas y no entre cada
 * par de unidades.
 */
export function convert(
  quantity: Quantity,
  to: Unit,
  bridges: ConversionBridges = {},
  itemId?: string,
): Quantity {
  if (quantity.unit === to) {
    return quantity;
  }

  const fromDimension = dimensionOf(quantity.unit);
  const toDimension = dimensionOf(to);

  // 1. A la canonica de origen.
  const canonical = quantity.amount.times(factorToCanonical(quantity.unit));

  // 2. Puente entre canonicas si cambia la dimension.
  const bridged =
    fromDimension === toDimension
      ? canonical
      : bridgeCanonical(canonical, fromDimension, toDimension, bridges, itemId);

  // 3. De la canonica de destino a la unidad pedida.
  return Quantity.of(bridged.dividedBy(factorToCanonical(to)), to);
}

function bridgeCanonical(
  amount: Decimal,
  from: ReturnType<typeof dimensionOf>,
  to: ReturnType<typeof dimensionOf>,
  bridges: ConversionBridges,
  itemId?: string,
): Decimal {
  const { densityGPerMl, weightPerPieceG } = bridges;

  switch (`${from}->${to}`) {
    // Volumen a masa: ml * (g/ml) = g
    case 'VOLUME->MASS':
      return amount.times(requirePositive(densityGPerMl, 'densidad', itemId));

    // Masa a volumen: g / (g/ml) = ml
    case 'MASS->VOLUME':
      return amount.dividedBy(requirePositive(densityGPerMl, 'densidad', itemId));

    // Piezas a masa: ud * (g/ud) = g
    case 'COUNT->MASS':
      return amount.times(requirePositive(weightPerPieceG, 'peso por pieza', itemId));

    // Masa a piezas: g / (g/ud) = ud.  Media cebolla se resuelve aqui.
    case 'MASS->COUNT':
      return amount.dividedBy(requirePositive(weightPerPieceG, 'peso por pieza', itemId));

    // Piezas a volumen y viceversa: encadena los dos puentes pasando por gramos.
    case 'COUNT->VOLUME':
      return amount
        .times(requirePositive(weightPerPieceG, 'peso por pieza', itemId))
        .dividedBy(requirePositive(densityGPerMl, 'densidad', itemId));

    case 'VOLUME->COUNT':
      return amount
        .times(requirePositive(densityGPerMl, 'densidad', itemId))
        .dividedBy(requirePositive(weightPerPieceG, 'peso por pieza', itemId));

    /* c8 ignore next 6 -- defensa: las seis combinaciones posibles estan cubiertas arriba */
    default:
      throw new IncompatibleUnitsError(
        CANONICAL_UNIT[from],
        CANONICAL_UNIT[to],
        'no existe puente entre esas dimensiones',
      );
  }
}

/** Unidades de uso que rinde una unidad de compra: 6 botellas x 700 ml = 4200 ml. */
export function usageUnitsPerPurchaseUnit(units: ItemUnits): Decimal {
  const factor = units.purchaseToStock.times(units.stockToUsage);
  if (!factor.isFinite() || !factor.greaterThan(0)) {
    throw new InvalidValueError(
      'factores de conversion compra/stock/uso',
      factor.toString(),
      'un producto finito y mayor que cero',
    );
  }
  return factor;
}

/**
 * Coste de una unidad de uso a partir del precio de compra.
 *
 * Devuelve un `Money` con centimos fraccionarios: el gramo de perejil cuesta
 * una milesima de centimo y redondearlo aqui destruiria el escandallo.
 */
export function costPerUsageUnit(purchasePrice: Money, units: ItemUnits): Money {
  return purchasePrice.dividedBy(usageUnitsPerPurchaseUnit(units), 'el coste por unidad de uso');
}

/**
 * Convierte una cantidad a la unidad de uso del item, usando sus puentes.
 * Atajo para el caso mas frecuente del motor.
 */
export function toUsageUnit(quantity: Quantity, item: CatalogItem): Quantity {
  return convert(quantity, item.units.usageUnit, item.units, item.id);
}

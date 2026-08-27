import { Decimal, ONE } from './decimal.js';
import { foodCostRatio, grossMargin, netPriceFromGross } from './costing.js';
import { InvalidValueError } from './errors.js';
import { Money } from './money.js';

/**
 * Estrategias de redondeo del precio de carta.
 *
 * Siempre redondean **hacia arriba**: bajar el precio para cuadrar un numero
 * bonito empeora el food cost, y esa decision la toma una persona, no el motor.
 */
export type RoundingStrategy =
  'NONE' | 'UP_TO_5_CENTS' | 'UP_TO_10_CENTS' | 'UP_TO_50_CENTS' | 'UP_TO_EURO' | 'CHARM_90';

const STEP_CENTS: Record<Exclude<RoundingStrategy, 'NONE' | 'CHARM_90'>, number> = {
  UP_TO_5_CENTS: 5,
  UP_TO_10_CENTS: 10,
  UP_TO_50_CENTS: 50,
  UP_TO_EURO: 100,
};

/** Redondea un precio segun la estrategia elegida. */
export function roundPrice(price: Money, strategy: RoundingStrategy): Money {
  if (strategy === 'NONE') {
    return price.round();
  }

  const cents = price.exactCents;

  if (strategy === 'CHARM_90') {
    // Precio psicologico terminado en ,90 -- el siguiente hacia arriba.
    const euros = cents.dividedBy(100).floor();
    const candidate = euros.times(100).plus(90);
    return Money.fromCents(candidate.lessThan(cents) ? candidate.plus(100) : candidate);
  }

  const step = new Decimal(STEP_CENTS[strategy]);
  return Money.fromCents(cents.dividedBy(step).ceil().times(step));
}

export interface PriceSuggestion {
  /** PVP sin IVA que cumple el objetivo exacto, antes de redondear. */
  readonly netPrice: Money;
  readonly vatAmount: Money;
  /** PVP con IVA correspondiente a `netPrice`. */
  readonly grossPrice: Money;
  /** PVP de carta, ya redondeado. Es el que se publica. */
  readonly roundedGrossPrice: Money;
  /** Base imponible del precio de carta redondeado. */
  readonly roundedNetPrice: Money;
  /** Food cost real que se obtiene con el precio redondeado, como fraccion. */
  readonly effectiveFoodCost: Decimal;
  readonly grossMargin: Money;
}

export interface PricingOptions {
  readonly rounding?: RoundingStrategy;
}

/**
 * Calculo inverso: que hay que cobrar para alcanzar un food cost objetivo.
 *
 * El objetivo se define sobre el **PVP sin IVA**, que es la definicion
 * contable correcta. El IVA no es ingreso del restaurante, asi que incluirlo
 * en el denominador maquillaria el food cost a la baja.
 *
 * @param targetFoodCost fraccion en (0, 1]: `0.28` para un objetivo del 28 %.
 */
export function priceForTargetFoodCost(
  costPerPortion: Money,
  targetFoodCost: Decimal,
  vatRate: Decimal,
  options: PricingOptions = {},
): PriceSuggestion {
  if (
    !targetFoodCost.isFinite() ||
    !targetFoodCost.greaterThan(0) ||
    targetFoodCost.greaterThan(1)
  ) {
    throw new InvalidValueError(
      'food cost objetivo',
      targetFoodCost.toString(),
      'una fraccion en el rango (0, 1]; un objetivo del 28 % se escribe 0.28',
    );
  }
  if (!vatRate.isFinite() || vatRate.isNegative()) {
    throw new InvalidValueError(
      'tipo de IVA',
      vatRate.toString(),
      'una fraccion no negativa; el 10 % se escribe 0.10',
    );
  }
  if (costPerPortion.isNegative()) {
    throw new InvalidValueError(
      'coste por racion',
      costPerPortion.toEuros(),
      'un importe no negativo',
    );
  }

  const netPrice = costPerPortion.dividedBy(targetFoodCost, 'el PVP objetivo');
  const vatAmount = netPrice.times(vatRate);
  const grossPrice = netPrice.plus(vatAmount);
  const roundedGrossPrice = roundPrice(grossPrice, options.rounding ?? 'UP_TO_50_CENTS');
  const roundedNetPrice = netPriceFromGross(roundedGrossPrice, vatRate);

  return {
    netPrice,
    vatAmount,
    grossPrice,
    roundedGrossPrice,
    roundedNetPrice,
    effectiveFoodCost: costPerPortion.isZero()
      ? new Decimal(0)
      : foodCostRatio(costPerPortion, roundedNetPrice),
    grossMargin: grossMargin(costPerPortion, roundedNetPrice),
  };
}

/**
 * Camino inverso al anterior: dado un precio de carta ya fijado, que food cost
 * sale. Lo usa el cuadro de mando para senalar los platos por encima del
 * objetivo.
 */
export function foodCostOfListedPrice(
  costPerPortion: Money,
  grossPrice: Money,
  vatRate: Decimal,
): Decimal {
  return foodCostRatio(costPerPortion, netPriceFromGross(grossPrice, vatRate));
}

/** Multiplicador sobre coste que implica un food cost objetivo: 0,28 -> x3,571. */
export function markupForTargetFoodCost(targetFoodCost: Decimal): Decimal {
  if (
    !targetFoodCost.isFinite() ||
    !targetFoodCost.greaterThan(0) ||
    targetFoodCost.greaterThan(1)
  ) {
    throw new InvalidValueError(
      'food cost objetivo',
      targetFoodCost.toString(),
      'una fraccion en el rango (0, 1]',
    );
  }
  return ONE.dividedBy(targetFoodCost);
}

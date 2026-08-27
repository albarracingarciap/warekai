/**
 * @warekai/domain -- motor de costes de cocina.
 *
 * TypeScript puro. Sin framework, sin base de datos, sin red. Se ejecuta en un
 * Node limpio y todas sus funciones son puras: mismas entradas, mismas
 * salidas, sin efectos.
 *
 * Toda regla de calculo del sistema vive aqui. Ni los controladores de la API
 * ni los componentes de React deciden nada sobre costes o mermas.
 */

export { Decimal, dec, ZERO, ONE, HUNDRED, type DecimalInput } from './decimal.js';

export {
  DomainError,
  IncompatibleUnitsError,
  MissingConversionFactorError,
  InvalidYieldError,
  CyclicRecipeError,
  UnknownItemError,
  UnknownRecipeError,
  DivisionByZeroError,
  InvalidValueError,
  MissingPurchasePriceError,
} from './errors.js';

export {
  ALL_UNITS,
  CANONICAL_UNIT,
  Quantity,
  dimensionOf,
  factorToCanonical,
  isUnit,
  unitDefinition,
  unitLabel,
  type Dimension,
  type Unit,
} from './units.js';

export { Money } from './money.js';

export {
  convert,
  costPerUsageUnit,
  toUsageUnit,
  usageUnitsPerPurchaseUnit,
  type ConversionBridges,
} from './conversion.js';

export {
  assertYieldFactor,
  chainYields,
  grossFromNet,
  netFromGross,
  netOutput,
  outputCostPerUnit,
  type YieldKind,
} from './yield.js';

export { dependenciesOf, dependentsOf, findCycle, topologicalOrder } from './graph.js';

export {
  assertRecipeNode,
  buildUnitCostIndex,
  costingUnitOf,
  explodeRecipe,
  requireItem,
  requireRecipe,
  type ExplodedLine,
  type UnitCost,
  type UnitCostIndex,
} from './explode.js';

export {
  calculateRecipeCost,
  foodCostPercentage,
  foodCostRatio,
  grossMargin,
  grossMarginPercentage,
  grossPriceFromNet,
  netPriceFromGross,
  type CostBreakdown,
} from './costing.js';

export {
  foodCostOfListedPrice,
  markupForTargetFoodCost,
  priceForTargetFoodCost,
  roundPrice,
  type PriceSuggestion,
  type PricingOptions,
  type RoundingStrategy,
} from './pricing.js';

export { scaleRecipe, scaleRecipeToOutput } from './scaling.js';

export { propagateAllergens, propagateRecipeAllergens } from './allergens.js';

export type {
  AllergenCode,
  AllergenPresence,
  AllergenPresenceLevel,
  Catalog,
  CatalogItem,
  ItemKind,
  ItemUnits,
  RecipeBook,
  RecipeLineInput,
  RecipeNode,
} from './types.js';

import { z } from 'zod';
import { allergenPresenceSchema, unitSchema } from './catalog.js';
import {
  centsSchema,
  decimalStringSchema,
  nonEmptyString,
  paginationSchema,
  positiveDecimalStringSchema,
  ratioSchema,
  uuidSchema,
  yieldFactorSchema,
} from './common.js';

/**
 * Linea de receta.
 *
 * `quantity` es peso NETO -- lo que llega al plato, ya limpio. El motor deduce
 * lo que hay que comprar dividiendo por el factor de correccion. Es la
 * convencion del escandallo profesional y evita que el cocinero tenga que
 * hacer la cuenta mentalmente.
 */
export const recipeLineSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  itemName: z.string(),
  itemIsPreparation: z.boolean(),
  quantity: positiveDecimalStringSchema,
  unit: unitSchema,
  /** Sustituye al factor de correccion del item solo en esta linea. */
  cleaningYieldOverride: yieldFactorSchema.nullable(),
  note: z.string().nullable(),
  sortOrder: z.number().int().nonnegative(),
});
export type RecipeLineDto = z.infer<typeof recipeLineSchema>;

export const recipeSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  itemName: z.string(),
  versionNo: z.number().int().min(1),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime().nullable(),
  /** Merma de proceso o rendimiento del lote, en (0, 1]. */
  yieldFactor: yieldFactorSchema,
  /** Produccion del lote ANTES de aplicar la merma de proceso. */
  outputQuantity: positiveDecimalStringSchema,
  outputUnit: unitSchema,
  portions: z.number().int().min(1),
  /** PVP de carta con IVA, en centimos. Solo para articulos de venta. */
  listPriceCents: centsSchema.nullable(),
  method: z.string().nullable(),
  lines: z.array(recipeLineSchema),
  updatedAt: z.string().datetime(),
});
export type RecipeDto = z.infer<typeof recipeSchema>;

export const recipeListEntrySchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  itemName: z.string(),
  versionNo: z.number().int(),
  isSaleItem: z.boolean(),
  portions: z.number().int(),
  costPerPortionCents: centsSchema.nullable(),
  listPriceCents: centsSchema.nullable(),
  foodCostRatio: decimalStringSchema.nullable(),
  updatedAt: z.string().datetime(),
});
export type RecipeListEntryDto = z.infer<typeof recipeListEntrySchema>;

const recipeLineWritableSchema = z
  .object({
    itemId: uuidSchema,
    quantity: positiveDecimalStringSchema,
    unit: unitSchema,
    cleaningYieldOverride: yieldFactorSchema.nullable().default(null),
    note: z.string().trim().max(400).nullable().default(null),
  })
  .strict();

export const createRecipeSchema = z
  .object({
    itemId: uuidSchema,
    yieldFactor: yieldFactorSchema.default('1'),
    outputQuantity: positiveDecimalStringSchema,
    outputUnit: unitSchema,
    portions: z.number().int().min(1).default(1),
    listPriceCents: centsSchema.nullable().default(null),
    method: z.string().trim().max(8000).nullable().default(null),
    lines: z.array(recipeLineWritableSchema).default([]),
  })
  .strict();
export type CreateRecipeDto = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = createRecipeSchema.partial().omit({ itemId: true });
export type UpdateRecipeDto = z.infer<typeof updateRecipeSchema>;

export const recipeQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(160).optional(),
  onlySale: z.coerce.boolean().default(false),
  /** Solo los que superan el food cost objetivo. Lo usa el cuadro de mando. */
  aboveTarget: z.coerce.boolean().default(false),
});
export type RecipeQuery = z.infer<typeof recipeQuerySchema>;

// --- Escandallo calculado ----------------------------------------------------

export const explodedLineSchema = z.object({
  itemId: uuidSchema,
  itemName: z.string(),
  path: z.array(uuidSchema),
  depth: z.number().int().nonnegative(),
  isPreparation: z.boolean(),
  netQuantity: decimalStringSchema,
  netUnit: unitSchema,
  grossQuantity: decimalStringSchema,
  grossUnit: unitSchema,
  cleaningYield: decimalStringSchema,
  /** Centimos por unidad bruta. Puede ser fraccionario. */
  unitCostCents: decimalStringSchema,
  lineCostCents: decimalStringSchema,
  /** Peso de la linea sobre el coste total, en fraccion. */
  shareOfTotal: decimalStringSchema,
});
export type ExplodedLineDto = z.infer<typeof explodedLineSchema>;

export const costingSchema = z.object({
  recipeId: uuidSchema,
  itemId: uuidSchema,
  itemName: z.string(),
  totalCostCents: centsSchema,
  costPerPortionCents: centsSchema,
  portions: z.number().int(),
  netOutputQuantity: decimalStringSchema,
  netOutputUnit: unitSchema,
  costPerOutputUnitCents: decimalStringSchema,
  listPriceCents: centsSchema.nullable(),
  vatRate: ratioSchema,
  /** Nulos cuando el item no tiene PVP de carta. */
  foodCostRatio: decimalStringSchema.nullable(),
  grossMarginCents: centsSchema.nullable(),
  allergens: z.array(allergenPresenceSchema),
  lines: z.array(explodedLineSchema),
  calculatedAt: z.string().datetime(),
});
export type CostingDto = z.infer<typeof costingSchema>;

/**
 * Escandallo en vivo mientras se edita.
 *
 * El editor manda las lineas sin guardar y recibe el coste. Asi la regla de
 * calculo sigue viviendo en `packages/domain` y no se duplica en React.
 */
export const draftCostingSchema = z
  .object({
    itemId: uuidSchema,
    yieldFactor: yieldFactorSchema,
    outputQuantity: positiveDecimalStringSchema,
    outputUnit: unitSchema,
    portions: z.number().int().min(1),
    listPriceCents: centsSchema.nullable().default(null),
    lines: z.array(recipeLineWritableSchema),
  })
  .strict();
export type DraftCostingDto = z.infer<typeof draftCostingSchema>;

export const priceSuggestionQuerySchema = z.object({
  targetFoodCost: ratioSchema.default('0.30'),
  rounding: z
    .enum(['NONE', 'UP_TO_5_CENTS', 'UP_TO_10_CENTS', 'UP_TO_50_CENTS', 'UP_TO_EURO', 'CHARM_90'])
    .default('UP_TO_50_CENTS'),
});
export type PriceSuggestionQuery = z.infer<typeof priceSuggestionQuerySchema>;

export const priceSuggestionSchema = z.object({
  netPriceCents: decimalStringSchema,
  vatAmountCents: decimalStringSchema,
  grossPriceCents: decimalStringSchema,
  roundedGrossPriceCents: centsSchema,
  roundedNetPriceCents: decimalStringSchema,
  effectiveFoodCost: decimalStringSchema,
  grossMarginCents: decimalStringSchema,
});
export type PriceSuggestionDto = z.infer<typeof priceSuggestionSchema>;

export const scaleRecipeQuerySchema = z.object({
  portions: z.coerce.number().int().min(1).max(2000),
});

export const recalculationJobSchema = z.object({
  jobId: z.string(),
  /** Recetas encoladas para recalcular, en orden topologico. */
  affectedRecipeIds: z.array(uuidSchema),
  status: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']),
});
export type RecalculationJobDto = z.infer<typeof recalculationJobSchema>;

export const dashboardSchema = z.object({
  saleItemCount: z.number().int().nonnegative(),
  pricedSaleItemCount: z.number().int().nonnegative(),
  averageFoodCost: decimalStringSchema.nullable(),
  targetFoodCost: decimalStringSchema,
  aboveTarget: z.array(
    z.object({
      recipeId: uuidSchema,
      itemId: uuidSchema,
      itemName: nonEmptyString(),
      foodCostRatio: decimalStringSchema,
      costPerPortionCents: centsSchema,
      listPriceCents: centsSchema,
    }),
  ),
  staleRecipeCount: z.number().int().nonnegative(),
});
export type DashboardDto = z.infer<typeof dashboardSchema>;

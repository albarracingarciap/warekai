import { z } from 'zod';
import {
  centsSchema,
  decimalStringSchema,
  nonEmptyString,
  paginationSchema,
  positiveCentsSchema,
  positiveDecimalStringSchema,
  ratioSchema,
  uuidSchema,
  yieldFactorSchema,
} from './common.js';

export const unitSchema = z.enum(['g', 'kg', 'ml', 'cl', 'l', 'ud']);
export type Unit = z.infer<typeof unitSchema>;

export const itemKindSchema = z.enum(['RAW', 'PREP', 'SALE']);
export type ItemKind = z.infer<typeof itemKindSchema>;

/** Los 14 alergenos de declaracion obligatoria (Reglamento UE 1169/2011). */
export const allergenCodeSchema = z.enum([
  'GLUTEN',
  'CRUSTACEOS',
  'HUEVOS',
  'PESCADO',
  'CACAHUETES',
  'SOJA',
  'LACTEOS',
  'FRUTOS_DE_CASCARA',
  'APIO',
  'MOSTAZA',
  'SESAMO',
  'SULFITOS',
  'ALTRAMUCES',
  'MOLUSCOS',
]);
export type AllergenCode = z.infer<typeof allergenCodeSchema>;

export const allergenLevelSchema = z.enum(['CONTAINS', 'TRACES']);

export const allergenPresenceSchema = z.object({
  code: allergenCodeSchema,
  level: allergenLevelSchema,
});
export type AllergenPresence = z.infer<typeof allergenPresenceSchema>;

export const ALLERGEN_LABELS: Record<AllergenCode, string> = {
  GLUTEN: 'Cereales con gluten',
  CRUSTACEOS: 'Crustaceos',
  HUEVOS: 'Huevos',
  PESCADO: 'Pescado',
  CACAHUETES: 'Cacahuetes',
  SOJA: 'Soja',
  LACTEOS: 'Leche y lacteos',
  FRUTOS_DE_CASCARA: 'Frutos de cascara',
  APIO: 'Apio',
  MOSTAZA: 'Mostaza',
  SESAMO: 'Granos de sesamo',
  SULFITOS: 'Dioxido de azufre y sulfitos',
  ALTRAMUCES: 'Altramuces',
  MOLUSCOS: 'Moluscos',
};

/**
 * La triple unidad de un item.
 *
 * Compra y stock son niveles de empaquetado con etiqueta libre; solo la unidad
 * de uso es fisica. Densidad y peso por pieza son los puentes entre
 * dimensiones y solo hacen falta cuando la receta mide en una magnitud
 * distinta de la de uso.
 */
export const itemUnitsSchema = z
  .object({
    purchaseUnitLabel: nonEmptyString(40),
    stockUnitLabel: nonEmptyString(40),
    usageUnit: unitSchema,
    purchaseToStock: positiveDecimalStringSchema,
    stockToUsage: positiveDecimalStringSchema,
    densityGPerMl: positiveDecimalStringSchema.nullable().default(null),
    weightPerPieceG: positiveDecimalStringSchema.nullable().default(null),
  })
  .strict();
export type ItemUnitsDto = z.infer<typeof itemUnitsSchema>;

export const itemFamilySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  parentId: uuidSchema.nullable(),
  /** Ruta materializada de nombres, de la raiz a la hoja. */
  path: z.array(z.string()),
});
export type ItemFamilyDto = z.infer<typeof itemFamilySchema>;

export const itemSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  familyId: uuidSchema.nullable(),
  familyName: z.string().nullable(),
  kinds: z.array(itemKindSchema).min(1),
  units: itemUnitsSchema,
  /** Precio de UNA unidad de compra, en centimos. */
  purchasePriceCents: centsSchema.nullable(),
  /** Factor de correccion o merma de limpieza, en (0, 1]. */
  cleaningYield: yieldFactorSchema,
  vatRate: ratioSchema,
  allergens: z.array(allergenPresenceSchema),
  isActive: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type ItemDto = z.infer<typeof itemSchema>;

/**
 * Vista de listado: lo que cabe en una fila de tabla densa. Se separa del
 * detalle para no arrastrar unidades y alergenos en un listado de 400 filas.
 */
export const itemListEntrySchema = itemSchema.pick({
  id: true,
  code: true,
  name: true,
  familyName: true,
  kinds: true,
  purchasePriceCents: true,
  cleaningYield: true,
  isActive: true,
});
export type ItemListEntryDto = z.infer<typeof itemListEntrySchema>;

const itemWritableSchema = z
  .object({
    code: nonEmptyString(40),
    name: nonEmptyString(160),
    familyId: uuidSchema.nullable().default(null),
    kinds: z.array(itemKindSchema).min(1, 'Un item debe tener al menos un tipo'),
    units: itemUnitsSchema,
    purchasePriceCents: positiveCentsSchema.nullable().default(null),
    cleaningYield: yieldFactorSchema.default('1'),
    vatRate: ratioSchema.default('0.10'),
    allergens: z.array(allergenPresenceSchema).default([]),
    isActive: z.boolean().default(true),
  })
  .strict();

/**
 * Un item que se compra necesita precio. Uno que solo es elaboracion lo saca
 * de su receta, asi que ahi el precio de compra no aplica.
 */
export const createItemSchema = itemWritableSchema.superRefine((value, ctx) => {
  const soloElaboracion = value.kinds.every((kind) => kind === 'PREP');
  if (!soloElaboracion && value.purchasePriceCents === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['purchasePriceCents'],
      message: 'Un item que se compra necesita precio de compra',
    });
  }
});
export type CreateItemDto = z.infer<typeof createItemSchema>;

export const updateItemSchema = itemWritableSchema.partial();
export type UpdateItemDto = z.infer<typeof updateItemSchema>;

export const itemQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(160).optional(),
  kind: itemKindSchema.optional(),
  familyId: uuidSchema.optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export type ItemQuery = z.infer<typeof itemQuerySchema>;

export const createItemFamilySchema = z
  .object({
    name: nonEmptyString(120),
    parentId: uuidSchema.nullable().default(null),
  })
  .strict();
export type CreateItemFamilyDto = z.infer<typeof createItemFamilySchema>;

/** Conversion puntual que pide el editor de escandallo al cambiar de unidad. */
export const conversionPreviewSchema = z.object({
  itemId: uuidSchema,
  amount: decimalStringSchema,
  fromUnit: unitSchema,
  toUnit: unitSchema,
});
export type ConversionPreviewDto = z.infer<typeof conversionPreviewSchema>;

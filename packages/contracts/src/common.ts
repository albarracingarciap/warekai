import { z } from 'zod';

/**
 * Reglas de serializacion que comparten API y frontend.
 *
 * Dos decisiones que atraviesan todos los esquemas:
 *
 * 1. **El dinero viaja como entero de centimos.** Un entero cabe exacto en el
 *    `number` de JavaScript y en el `NUMERIC` de Postgres. Nunca se serializa
 *    un importe como decimal en coma flotante.
 * 2. **Los factores decimales viajan como cadena.** Densidades, mermas y tipos
 *    de IVA se transportan en texto (`'0.4'`) y se reconstruyen con Decimal en
 *    el motor. Un `0.1` que pasa por un `number` deja de ser `0.1`.
 */

export const uuidSchema = z.string().uuid('Identificador no valido');

/** Entero de centimos. Puede ser negativo en un ajuste o una diferencia. */
export const centsSchema = z.number().int('Los importes se expresan en centimos enteros').finite();

export const positiveCentsSchema = centsSchema.nonnegative('El importe no puede ser negativo');

/** Cadena que representa un decimal exacto: `'0.4'`, `'1000'`, `'0.916'`. */
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Se esperaba un numero decimal en formato texto, por ejemplo "0.4"');

/** Decimal estrictamente positivo. */
export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => Number.parseFloat(value) > 0,
  'Debe ser mayor que cero',
);

/**
 * Factor de merma. El rango (0, 1] se valida aqui ademas de en el motor: es el
 * error mas caro del dominio y conviene rechazarlo antes de tocar la base de
 * datos.
 */
export const yieldFactorSchema = decimalStringSchema.refine((value) => {
  const parsed = Number.parseFloat(value);
  return parsed > 0 && parsed <= 1;
}, 'El rendimiento va de 0 a 1. Un 40 % se escribe "0.4", no "40" ni "60"');

/** Fraccion no negativa: tipos de IVA, objetivos de food cost. */
export const ratioSchema = decimalStringSchema.refine(
  (value) => Number.parseFloat(value) >= 0,
  'Debe ser una fraccion no negativa',
);

export const nonEmptyString = (max = 200) => z.string().trim().min(1, 'Obligatorio').max(max);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const paginatedSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Forma estable de los errores de la API. El frontend se apoya en `code`. */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

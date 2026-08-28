import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Valida la entrada contra un esquema de `@warekai/contracts`.
 *
 * Devuelve el dato ya parseado -- con los valores por defecto aplicados y las
 * cadenas recortadas -- de modo que el servicio recibe siempre una forma
 * conocida y no tiene que volver a comprobar nada.
 *
 * El error sale con la misma forma que el resto de la API: un `code` estable
 * que el frontend puede tratar, y el detalle campo a campo para pintarlo en el
 * formulario.
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son validos.',
      details: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
}

/** Azucar para no repetir `new ZodValidationPipe(...)` en cada firma. */
export const zodPipe = <T extends ZodTypeAny>(schema: T): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);

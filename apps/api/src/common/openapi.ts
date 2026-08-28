import { ApiBody, ApiResponse } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Puente entre los esquemas Zod de `@warekai/contracts` y el documento OpenAPI.
 *
 * Los decoradores de Swagger describen la forma de los datos con clases y
 * decoradores propios, lo que obligaria a mantener una segunda definicion en
 * paralelo a la de los contratos. En vez de eso, se registran los esquemas Zod
 * que ya existen y se convierten a JSON Schema al construir el documento. Hay
 * una unica fuente de verdad, y la documentacion no puede quedarse obsoleta
 * respecto a la validacion porque son el mismo objeto.
 */
/**
 * `zodToJsonSchema` tiene un tipo de retorno recursivo que TypeScript no puede
 * expandir para esquemas grandes. Se estrecha la firma a la unica forma que
 * aqui interesa: entra un esquema, sale un objeto.
 */
const convert = zodToJsonSchema as unknown as (schema: ZodTypeAny, options: unknown) => object;

const registry = new Map<string, ZodTypeAny>();

export function registerSchema(name: string, schema: ZodTypeAny): string {
  registry.set(name, schema);
  return name;
}

/** Inserta todos los esquemas registrados en `components.schemas`. */
export function applyZodSchemas(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  for (const [name, schema] of registry) {
    document.components.schemas[name] = convert(schema, {
      target: 'openApi3',
      $refStrategy: 'none',
    }) as SchemaObject;
  }
  return document;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

export const ApiZodBody = (name: string) => ApiBody({ schema: ref(name) });

export const ApiZodResponse = (name: string, status = 200, description?: string) =>
  ApiResponse({ status, description, schema: ref(name) });

export const ApiZodArrayResponse = (name: string, status = 200) =>
  ApiResponse({ status, schema: { type: 'array', items: ref(name) } });

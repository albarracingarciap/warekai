import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Busca el `.env` mas cercano subiendo desde el directorio de trabajo.
 *
 * En un monorepo el fichero vive en la raiz, pero los comandos se lanzan desde
 * `apps/api`, desde la raiz o desde donde quiera el editor. Buscar hacia
 * arriba evita tener que recordar desde donde se arranca cada cosa.
 */
function findEnvFile(start: string): string | undefined {
  let dir = start;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const envFile = findEnvFile(process.cwd());
if (envFile) {
  loadDotenv({ path: envFile });
}

/**
 * Variables de entorno tipadas.
 *
 * Se validan al arrancar y el proceso muere si falta alguna. Un secreto de JWT
 * ausente que se descubre en el primer login de produccion es peor que un
 * arranque fallido.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url('DATABASE_URL debe ser una URL de conexion valida'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_CORS_ORIGIN: z.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(32, 'El secreto de acceso necesita al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'El secreto de refresco necesita al menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  /** Corto a proposito: una tablet de cocina se queda desatendida. */
  PIN_ACCESS_TTL: z.string().default('8h'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion invalida. Revisa tu .env:\n${detail}`);
  }
  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos: si coinciden, ' +
        'un token de acceso robado sirve tambien para refrescar la sesion.',
    );
  }
  cached = parsed.data;
  return cached;
}

/** Solo para pruebas: olvida la configuracion cacheada. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const ENV = Symbol('ENV');

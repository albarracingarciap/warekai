import { sql } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import { loadEnv } from '../config/env';

/**
 * Borra el esquema publico entero y lo deja vacio.
 *
 * Se niega a ejecutarse fuera de desarrollo: es una herramienta para volver a
 * un estado limpio mientras se itera sobre el modelo de datos, no algo que
 * deba existir cerca de produccion.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('db:reset no se ejecuta en produccion.');
  }
  console.log('Vaciando el esquema publico...');
  await getDb().execute(sql`drop schema public cascade; create schema public;`);
  console.log('Esquema vacio. Ejecuta `pnpm db:migrate` y `pnpm db:seed`.');
}

main()
  .catch((error: unknown) => {
    console.error('Fallo al reiniciar:', error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

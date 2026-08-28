import { defineConfig } from 'vitest/config';

/**
 * Pruebas que necesitan PostgreSQL de verdad.
 *
 * No se simula la base de datos: lo que se comprueba aqui -- que la seguridad a
 * nivel de fila aisla los tenants -- solo existe dentro de Postgres. Un doble
 * de prueba diria que si a todo.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Comparten base de datos: en serie para que no se pisen.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

import { defineConfig } from 'tsup';

/**
 * Doble salida a proposito: la API de NestJS se ejecuta en CommonJS y el
 * frontend de Vite en ESM. Publicar las dos evita el clasico
 * "Cannot use import statement outside a module" al arrancar la API, sin
 * obligar a ninguno de los dos lados a cambiar de sistema de modulos.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'node20',
});

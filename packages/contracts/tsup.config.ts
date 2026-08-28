import { defineConfig } from 'tsup';

/** Ver el razonamiento en packages/domain/tsup.config.ts. */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'node20',
});

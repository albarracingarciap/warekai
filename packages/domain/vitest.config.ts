import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // `index.ts` y `types.ts` no tienen codigo ejecutable: son reexportacion
      // y declaraciones de tipo. Su correccion la garantiza el compilador.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts', 'src/__fixtures__/**'],
      // El motor de costes es la pieza que no puede fallar: por debajo del
      // 100 % el comando falla y el pre-commit lo bloquea.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});

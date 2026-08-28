import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Las pruebas de integracion van aparte: necesitan PostgreSQL levantado y
    // se lanzan con `pnpm test:integration`.
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
  },
});

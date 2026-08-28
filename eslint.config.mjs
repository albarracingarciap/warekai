import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/migrations/**',
      '**/dev-dist/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // Requisito innegociable del proyecto: prohibido `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Los seeders y scripts de CLI sí escriben por consola.
    files: ['**/db/seed/**', '**/scripts/**', '**/*.seed.ts', '**/migrate.ts', '**/reset.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      // NestJS resuelve las dependencias del constructor leyendo los metadatos
      // que TypeScript emite con `emitDecoratorMetadata`, y solo los emite para
      // imports de valor. Convertir `import { CostingService }` en
      // `import type { CostingService }` deja el metadato vacío y el contenedor
      // inyecta `undefined` en tiempo de ejecución, sin ningún aviso al
      // compilar. La regla es correcta en general y está mal aquí.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);

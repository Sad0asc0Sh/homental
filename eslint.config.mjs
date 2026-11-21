// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/migrations/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // NOTE: `consistent-type-imports` is intentionally DISABLED.
      // With emitDecoratorMetadata: true, converting constructor-injected
      // classes to `import type` erases design:paramtypes tokens (Object) and
      // breaks NestJS DI at runtime (Part A hotfix #1).
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },
  {
    files: ['prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  eslintConfigPrettier,
);

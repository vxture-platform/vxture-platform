/**
 * Root ESLint flat config (ESLint v9)
 * Covers all TypeScript source files across the monorepo.
 * Per-directory configs (bff/, services/, portals/, etc.) that existed under
 * the old file-lookup model are superseded by this root config.
 */

// @ts-check
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/build/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/src/generated/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  {
    files: [
      'bff/**/src/**/*.ts',
      'services/**/src/**/*.ts',
      'packages/**/src/**/*.ts',
      'business/**/src/**/*.ts',
    ],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-trailing-spaces': ['error', { ignoreComments: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];

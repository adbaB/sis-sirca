import pluginJs from '@eslint/js';
import stylisticTs from '@stylistic/eslint-plugin';
import typescriptEslint from '@typescript-eslint/parser';
import prettierPluginRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'node_modules',
      'node_module',
      'pnpm-lock.yaml',
      '.prettierrc',
      '.env',
      'eslint.config.mjs',
      'dist',
      'src/database/migrations',
      'script',
      '.github',
      '.eslintrc.json',
      '*.hbs',
      '*.yml',
      '.agents',
    ],
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    plugins: {
      '@stylistic/ts': stylisticTs,
    },
    languageOptions: {
      parser: typescriptEslint,
      parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  prettierPluginRecommended,
];

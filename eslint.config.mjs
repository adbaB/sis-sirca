import pluginJs from '@eslint/js';
import stylisticTs from '@stylistic/eslint-plugin';
import typescriptEslint from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    plugins: {
      prettier,
      '@stylistic/ts': stylisticTs,
    },
    languageOptions: {
      parser: typescriptEslint,
      parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@stylistic/ts/indent': ['warn', 2],
      '@stylistic/ts/quotes': ['warn', 'single'],
      'no-trailing-spaces': 'warn',
    },
  },
  {
    ignores: [
      'node_module',
      'test',
      'pnpm-lock.yaml',
      '.prettierrc',
      '.env',
      'eslint.config.mjs',
      'dist',
      'src/database/migrations',
      '.github',
      '.eslintrc.json',
    ],
  },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
];

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'script/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});

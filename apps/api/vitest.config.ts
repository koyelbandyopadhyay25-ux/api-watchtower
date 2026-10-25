import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // DB suites deliberately contend for the same global capacity locks.
    // Separate test files must not consume one another's reserved test slots.
    fileParallelism: false,
    testTimeout: 10_000,
  },
});

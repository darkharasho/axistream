import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['test/e2e/**', 'node_modules/**'],
    setupFiles: ['./test/setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
  },
})

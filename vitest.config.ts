import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests run separately (need a real OBS); excluded from default run.
    exclude: ['test/integration/**', 'node_modules/**'],
    maxWorkers: 2,
    minWorkers: 1,
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/integration/**/*.itest.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
  },
})

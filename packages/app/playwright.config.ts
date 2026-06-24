import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './test/e2e', testMatch: '**/*.e2e.ts', timeout: 120000, expect: { timeout: 30000 }, fullyParallel: false, workers: 1 })

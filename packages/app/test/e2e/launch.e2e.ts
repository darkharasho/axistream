import { test, expect, _electron as electron } from '@playwright/test'

// Boots the built app and asserts the shell renders + reaches a known phase.
// Returning-user capture/stream paths need real OBS + a provisioned AxiStream
// collection (see docs/app-testing.md); first-run portal approval is manual.
test('app boots and shows the shell', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await expect(win.locator('.brand')).toContainText('AxiStream')
  // Unprovisioned first run shows the setup CTA:
  await expect(win.getByRole('button', { name: /set up capture/i })).toBeVisible({ timeout: 60000 })
  // Force-exit: OBS shutdown can take time; don't let it block the test.
  await app.close().catch(() => {})
})

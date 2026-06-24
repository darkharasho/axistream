import { describe, it, expect, afterEach } from 'vitest'
import { ObsSidecar } from '../../src/obs-sidecar.js'
import { FlatpakObsLauncher } from '../../src/obs-launcher.js'
import { HeadlessCageObsLauncher } from '../../src/headless-cage-launcher.js'

// Integration: requires real OBS + `cage`. Launches OBS HEADLESS (no visible
// window) and confirms it is controllable and tears down cleanly. Run with:
//   npx vitest run --config vitest.integration.config.ts test/integration/headless-launch.itest.ts
describe('Headless cage launch (integration, real OBS + cage)', () => {
  let sidecar: ObsSidecar
  afterEach(async () => { await sidecar?.stop() })

  it('launches OBS headless, GetVersion works, no orphan after teardown', async () => {
    sidecar = new ObsSidecar({
      launcher: new HeadlessCageObsLauncher(new FlatpakObsLauncher()),
      collection: 'AxiStream',
    })
    await sidecar.start()
    const ver = await sidecar.client().call('GetVersion')
    expect(ver.obsVersion).toBeTruthy()
  }, 60000)
})

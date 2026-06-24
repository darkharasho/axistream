import { describe, it, expect, afterEach } from 'vitest'
import { ObsSidecar } from '../../src/obs-sidecar.js'
import { FlatpakObsLauncher } from '../../src/obs-launcher.js'

// Integration: requires a real OBS install. Run explicitly:
//   npx vitest run --maxWorkers=2 --config vitest.integration.config.ts
describe('ObsSidecar (integration, real OBS)', () => {
  let sidecar: ObsSidecar
  afterEach(async () => { await sidecar?.stop() })

  it('launches OBS, connects, GetVersion works, clean teardown', async () => {
    sidecar = new ObsSidecar({ launcher: new FlatpakObsLauncher(), collection: 'AxiStream' })
    await sidecar.start()
    const ver = await sidecar.client().call('GetVersion')
    expect(ver.obsVersion).toBeTruthy()
    expect(sidecar.port).toBeGreaterThan(0)
  }, 60000)
})

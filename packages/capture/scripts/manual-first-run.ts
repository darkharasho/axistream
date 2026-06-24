import { ObsSidecar } from '../src/obs-sidecar.js'
import { FlatpakObsLauncher } from '../src/obs-launcher.js'
import { Provisioner } from '../src/provisioner.js'
import { CaptureConfig } from '../src/capture-config.js'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// MANUAL TEST — first-run portal approval cannot be automated (OS dialog).
// Run: npx tsx scripts/manual-first-run.ts
// When the system "Share your screen" dialog appears, pick a monitor and check
// "Remember", then approve. Success prints READY.
const main = async () => {
  const sidecar = new ObsSidecar({ launcher: new FlatpakObsLauncher(), collection: 'AxiStream' })
  await sidecar.start()
  const config = new CaptureConfig(join(mkdtempSync(join(tmpdir(), 'axman-')), 'c.json'))
  const p = new Provisioner({ sidecar, config, platform: 'linux' })
  console.log('Building capture + reloading OBS — APPROVE the screen-share dialog when it appears...')
  const res = await p.provision(() => console.log('>>> Approve the system screen-share dialog now (check Remember).'))
  console.log('Result:', res)
  await sidecar.stop()
  process.exit(res.ok ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })

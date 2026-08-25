import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectDiagnostics } from '../src/main/diagnostics.js'
import { INITIAL_STATE } from '../src/shared/state.js'

let root: string
const versions = { app: '0.1.15', electron: '31.0.0', node: '20.0.0', os: 'linux 6.1' }

const deps = (over: Partial<Parameters<typeof collectDiagnostics>[0]> = {}) => ({
  outDir: join(root, 'out'),
  logDir: join(root, 'logs'),
  obsConfigRoot: join(root, 'obscfg'),
  client: () => ({ call: async () => ({ scenes: [], inputs: [] }) }) as never,
  state: () => INITIAL_STATE,
  versions,
  ...over,
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'axi-diag-'))
  mkdirSync(join(root, 'logs'), { recursive: true })
  writeFileSync(join(root, 'logs', 'axistream.log'), 'hello log\n')
  mkdirSync(join(root, 'obscfg', 'obs-studio', 'logs'), { recursive: true })
  writeFileSync(join(root, 'obscfg', 'obs-studio', 'logs', '2026-08-24.txt'), 'obs log\n')
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('collectDiagnostics', () => {
  it('writes a zip and reports its path', async () => {
    const r = await collectDiagnostics(deps())
    expect(r.ok).toBe(true)
    expect(r.path).toMatch(/axistream-diagnostics-\d{8}-\d{6}\.zip$/)
    expect(existsSync(r.path!)).toBe(true)
  })

  // The whole point: diagnostics get collected when things are broken.
  it('still produces a zip when OBS is unreachable', async () => {
    const r = await collectDiagnostics(deps({ client: () => { throw new Error('no obs') } }))
    expect(r.ok).toBe(true)
    expect(existsSync(r.path!)).toBe(true)
  })

  it('succeeds when the OBS config root is missing', async () => {
    const r = await collectDiagnostics(deps({ obsConfigRoot: join(root, 'nope') }))
    expect(r.ok).toBe(true)
  })

  it('succeeds when there is no OBS client at all', async () => {
    const r = await collectDiagnostics(deps({ client: () => null }))
    expect(r.ok).toBe(true)
  })

  it('prunes to the five most recent bundles', async () => {
    const out = join(root, 'out')
    mkdirSync(out, { recursive: true })
    for (let i = 0; i < 8; i++) writeFileSync(join(out, `axistream-diagnostics-2026010${i}-000000.zip`), 'x')
    await collectDiagnostics(deps())
    expect(readdirSync(out).filter((f) => f.endsWith('.zip')).length).toBe(5)
  })
})

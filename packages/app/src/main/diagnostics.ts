import archiver from 'archiver'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pickState, scrubLine } from './redact.js'
import type { AppState, DiagnosticsResult } from '../shared/state.js'

interface ObsClientLike { call(request: string, data?: unknown): Promise<unknown> }

export interface DiagnosticsDeps {
  outDir: string
  logDir: string
  obsConfigRoot: string | null
  client: () => ObsClientLike | null
  state: () => AppState
  versions: { app: string; electron: string; node: string; os: string }
}

/** Keep the newest N bundles so a debugging session cannot grow without bound. */
const KEEP = 5

const stamp = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const scrubJson = (v: unknown): string => scrubLine(JSON.stringify(v, null, 2))

const safeClient = (d: DiagnosticsDeps): ObsClientLike | null => {
  try { return d.client() } catch { return null }
}

function prune(dir: string): void {
  try {
    const zips = readdirSync(dir)
      .filter((f) => f.startsWith('axistream-diagnostics-') && f.endsWith('.zip'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of zips.slice(KEEP)) rmSync(join(dir, f), { force: true })
  } catch { /* pruning is housekeeping, never fatal */ }
}

export async function collectDiagnostics(d: DiagnosticsDeps): Promise<DiagnosticsResult> {
  try {
    mkdirSync(d.outDir, { recursive: true })
    const path = join(d.outDir, `axistream-diagnostics-${stamp()}.zip`)
    const zip = archiver('zip', { zlib: { level: 9 } })
    const out = createWriteStream(path)
    const done = new Promise<void>((resolve, reject) => {
      out.on('close', () => resolve())
      zip.on('error', reject)
    })
    zip.pipe(out)

    // Every source is independently best-effort: a collector that dies because
    // OBS is unreachable is useless in exactly the case it exists for.
    const attempt = async (name: string, fn: () => Promise<string> | string): Promise<void> => {
      try { zip.append(await fn(), { name }) }
      catch (e) { zip.append(`${e instanceof Error ? e.message : String(e)}\n`, { name: `${name}.error.txt` }) }
    }

    await attempt('report.json', () => scrubJson({
      generatedAt: new Date().toISOString(),
      versions: d.versions,
      platform: process.platform,
      arch: process.arch,
      state: pickState(d.state()),
    }))

    for (const file of ['axistream.log', 'axistream.log.1', 'updater.log']) {
      const full = join(d.logDir, file)
      if (existsSync(full)) zip.file(full, { name: file })
    }

    if (d.obsConfigRoot) {
      const obsLogs = join(d.obsConfigRoot, 'obs-studio', 'logs')
      try {
        const recent = readdirSync(obsLogs)
          .filter((f) => f.endsWith('.txt'))
          .map((f) => ({ f, t: statSync(join(obsLogs, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t)
          .slice(0, 3)
        for (const { f } of recent) zip.file(join(obsLogs, f), { name: `obs/${f}` })
      } catch { /* no OBS logs is not a failure */ }
    }

    const client = safeClient(d)
    if (client) {
      await attempt('obs/scenes.json', async () => {
        const list = await client.call('GetSceneList') as { scenes: Array<{ sceneName: string }> }
        const scenes = []
        for (const s of list.scenes ?? []) {
          const items = await client.call('GetSceneItemList', { sceneName: s.sceneName })
          scenes.push({ scene: s.sceneName, items })
        }
        return scrubJson(scenes)
      })
      // Output state at collection time. The in-app preview is fed by OBS's
      // virtual camera, so "was the virtual cam actually running?" is the first
      // question any preview report needs answered — and it is invisible from
      // the renderer, which sees a placeholder frame either way.
      await attempt('obs/outputs.json', async () => {
        const one = async (req: string): Promise<unknown> => {
          try { return await client.call(req) }
          catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
        }
        return scrubJson({
          virtualCam: await one('GetVirtualCamStatus'),
          video: await one('GetVideoSettings'),
          stream: await one('GetStreamStatus'),
          record: await one('GetRecordStatus'),
        })
      })
      await attempt('obs/inputs.json', async () => {
        const list = await client.call('GetInputList') as { inputs: Array<{ inputName: string }> }
        const inputs = []
        for (const i of list.inputs ?? []) {
          const settings = await client.call('GetInputSettings', { inputName: i.inputName })
          inputs.push({ input: i.inputName, settings })
        }
        return scrubJson(inputs)
      })
    } else {
      zip.append('OBS was not connected when diagnostics were collected.\n', { name: 'obs/scenes.error.txt' })
    }

    await zip.finalize()
    await done
    prune(d.outDir)
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

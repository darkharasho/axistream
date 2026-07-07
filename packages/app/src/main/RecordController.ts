export interface RecordDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
  sleep?: (ms: number) => Promise<void>
}
export interface TestRecordingResult { ok: boolean; outputPath?: string; error?: string }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Drives one short test recording through OBS's Simple-output recorder.
// RecQuality 'Stream' shares the stream encoders, so the recorded audio path
// is byte-identical to what viewers hear. Best-effort — never throws.
export class RecordController {
  constructor(private readonly d: RecordDeps) {}

  async recordTestClip(durationMs: number, dir: string): Promise<TestRecordingResult> {
    const c = this.d.client()
    const sleep = this.d.sleep ?? defaultSleep
    const set = (parameterName: string, parameterValue: string) =>
      c.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName, parameterValue })
    try {
      await set('FilePath', dir)
      await set('RecFormat2', 'fragmented_mp4')
      await set('RecQuality', 'Stream')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[record] setting record params failed', msg)
      return { ok: false, error: msg }
    }
    try {
      await c.call('StartRecord')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[record] StartRecord failed', msg)
      return { ok: false, error: msg }
    }
    await sleep(durationMs)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await c.call('StopRecord') as { outputPath?: string }
        if (!r.outputPath) return { ok: false, error: 'no output path from OBS' }
        return { ok: true, outputPath: r.outputPath }
      } catch (e) {
        if (attempt === 1) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn('[record] StopRecord failed', msg)
          return { ok: false, error: msg }
        }
      }
    }
    return { ok: false, error: 'unreachable' }
  }
}

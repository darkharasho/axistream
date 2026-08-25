import type { RecordStartResult, RecordStopResult } from '../shared/state.js'

export type RecordFormat = 'mp4' | 'fragmented_mp4'

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

  private async setParams(dir: string, format: RecordFormat): Promise<void> {
    const c = this.d.client()
    const set = (parameterName: string, parameterValue: string) =>
      c.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName, parameterValue })
    await set('FilePath', dir)
    // Always explicit: the audio test and VOD recording share one OBS profile,
    // so neither may inherit whatever the other last wrote.
    await set('RecFormat2', format)
    // 'Stream' shares the stream encoders — no extra encode, and the recorded
    // audio path is byte-identical to what viewers hear.
    await set('RecQuality', 'Stream')
  }

  /** Starts a long-form recording. Best-effort — never throws. */
  async startRecording(dir: string, format: RecordFormat): Promise<RecordStartResult> {
    const c = this.d.client()
    const sleep = this.d.sleep ?? defaultSleep
    try {
      await this.setParams(dir, format)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.warn('[record] setting record params failed', error)
      return { ok: false, error }
    }
    try {
      await c.call('StartRecord')
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.warn('[record] StartRecord failed', error)
      return { ok: false, error }
    }
    // StartRecord only means "request accepted" — the output can die right
    // after (a FilePath that doesn't exist inside OBS's flatpak namespace).
    await sleep(300)
    try {
      const st = await c.call('GetRecordStatus') as { outputActive?: boolean }
      if (!st.outputActive) {
        return { ok: false, error: 'recording did not start — is the record folder writable by OBS?' }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.warn('[record] GetRecordStatus failed', error)
      return { ok: false, error }
    }
    return { ok: true }
  }

  /** Stops a long-form recording. Does not wait for file stability — fragmented
   *  mp4 needs no moov fixup, and the UI must not block after a stop. */
  async stopRecording(): Promise<RecordStopResult> {
    const c = this.d.client()
    let lastError = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await c.call('StopRecord') as { outputPath?: string }
        return { ok: true, outputPath: r.outputPath }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
    console.warn('[record] StopRecord failed', lastError)
    return { ok: false, error: lastError }
  }

  async isRecording(): Promise<boolean> {
    try {
      const st = await this.d.client().call('GetRecordStatus') as { outputActive?: boolean }
      return Boolean(st.outputActive)
    } catch {
      return false
    }
  }

  async recordTestClip(durationMs: number, dir: string): Promise<TestRecordingResult> {
    const c = this.d.client()
    const sleep = this.d.sleep ?? defaultSleep
    try {
      await this.setParams(dir, 'mp4')
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
    // StartRecord only means "request accepted" — the output can die right
    // after (e.g. a FilePath that doesn't exist inside OBS's flatpak
    // namespace). Verify it actually went active before burning the full
    // record window on a dead output.
    await sleep(300)
    try {
      const st = await c.call('GetRecordStatus') as { outputActive?: boolean }
      if (!st.outputActive) {
        console.warn('[record] output did not start (bad record folder?)')
        return { ok: false, error: 'recording did not start — is the record folder writable by OBS?' }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[record] GetRecordStatus failed', msg)
      return { ok: false, error: msg }
    }
    await sleep(durationMs)
    let lastError = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await c.call('StopRecord') as { outputPath?: string }
        if (!r.outputPath) return { ok: false, error: 'no output path from OBS' }
        return { ok: true, outputPath: r.outputPath }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
    console.warn('[record] StopRecord failed', lastError)
    return { ok: false, error: lastError }
  }
}

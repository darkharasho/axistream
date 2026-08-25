import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface LogSink {
  write(level: LogLevel, message: string): void
  readonly path: string
  readonly backupPath: string
}

export interface LogSinkOptions {
  dir: string
  /** Rotate once the file exceeds this. One backup is kept, so the footprint is bounded at 2x. */
  maxBytes?: number
  scrub?: (s: string) => string
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export function createLogSink(opts: LogSinkOptions): LogSink {
  const path = join(opts.dir, 'axistream.log')
  const backupPath = `${path}.1`
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const scrub = opts.scrub ?? ((s: string) => s)
  let ensured = false

  const rotate = (): void => {
    let size = 0
    try { size = statSync(path).size } catch { return }
    if (size <= maxBytes) return
    try { rmSync(backupPath, { force: true }) } catch { /* best effort */ }
    try { renameSync(path, backupPath) } catch { /* best effort */ }
  }

  return {
    path,
    backupPath,
    write(level, message) {
      // Swallows everything: a full disk must not take the app down.
      try {
        if (!ensured) { mkdirSync(opts.dir, { recursive: true }); ensured = true }
        rotate()
        appendFileSync(path, `${new Date().toISOString()} ${level} ${scrub(message)}\n`)
      } catch { /* logging must never be load-bearing */ }
    },
  }
}

const LEVELS: Array<[keyof Console, LogLevel]> = [['log', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]

const safeJson = (v: unknown): string => {
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

const format = (args: unknown[]): string => args
  .map((a) => a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : safeJson(a))
  .join(' ')

/**
 * Tee console output into the sink, keeping the original console so `npm run
 * dev` is unchanged. Returns a restore function (used by tests; production
 * installs once for the process lifetime).
 */
export function installLogSink(sink: LogSink): () => void {
  const originals = LEVELS.map(([key]) => [key, console[key]] as const)
  for (const [key, level] of LEVELS) {
    const original = console[key] as (...a: unknown[]) => void
    ;(console as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      original(...args)
      sink.write(level, format(args))
    }
  }
  return () => { for (const [key, fn] of originals) (console as unknown as Record<string, unknown>)[key] = fn }
}

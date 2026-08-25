import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLogSink, installLogSink } from '../src/main/log.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axi-log-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('log sink', () => {
  it('writes a timestamped, levelled line', () => {
    const sink = createLogSink({ dir })
    sink.write('WARN', 'capture stalled')
    const body = readFileSync(sink.path, 'utf8')
    expect(body).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z WARN capture stalled$/m)
  })

  it('applies the scrub function before writing', () => {
    const sink = createLogSink({ dir, scrub: (s) => s.replace('secret', '<x>') })
    sink.write('INFO', 'a secret value')
    expect(readFileSync(sink.path, 'utf8')).toContain('a <x> value')
  })

  // Rotation is tested against a real filesystem; a mocked fs hides exactly
  // the ordering bugs rotation is prone to.
  it('rotates into a single backup once maxBytes is exceeded', () => {
    const sink = createLogSink({ dir, maxBytes: 200 })
    for (let i = 0; i < 40; i++) sink.write('INFO', `line ${i} ${'x'.repeat(20)}`)
    expect(existsSync(join(dir, 'axistream.log'))).toBe(true)
    expect(existsSync(join(dir, 'axistream.log.1'))).toBe(true)
    expect(existsSync(join(dir, 'axistream.log.2'))).toBe(false)
  })

  it('keeps only the newest backup when rotating twice', () => {
    const sink = createLogSink({ dir, maxBytes: 100 })
    for (let i = 0; i < 30; i++) sink.write('INFO', `${'y'.repeat(40)} ${i}`)
    const backup = readFileSync(join(dir, 'axistream.log.1'), 'utf8')
    expect(backup).not.toContain('y'.repeat(40) + ' 0')
  })

  it('never throws when the directory cannot be written', () => {
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, 'i am a file, not a directory')
    const sink = createLogSink({ dir: blocked })
    expect(() => sink.write('ERROR', 'boom')).not.toThrow()
  })

  it('tees console.warn to the sink and restores on dispose', () => {
    const sink = createLogSink({ dir })
    const restore = installLogSink(sink)
    console.warn('through the tee')
    restore()
    console.warn('after restore')
    const body = readFileSync(sink.path, 'utf8')
    expect(body).toContain('through the tee')
    expect(body).not.toContain('after restore')
  })
})

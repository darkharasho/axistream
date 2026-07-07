import { describe, it, expect } from 'vitest'
import { recreateMissingAppImage } from '../src/main/updater.js'

const fsWith = (exists: boolean, throwOnWrite = false) => {
  const writes: string[] = []
  return {
    impl: {
      existsSync: () => exists,
      writeFileSync: (p: unknown) => { if (throwOnWrite) throw new Error('EACCES'); writes.push(String(p)) },
    } as never,
    writes,
  }
}

describe('recreateMissingAppImage', () => {
  it('skips off-linux and without APPIMAGE', () => {
    expect(recreateMissingAppImage('/x', 'win32')).toBe('skipped')
    expect(recreateMissingAppImage(undefined, 'linux')).toBe('skipped')
  })
  it('reports present without writing', () => {
    const f = fsWith(true)
    expect(recreateMissingAppImage('/apps/Axi.AppImage', 'linux', f.impl)).toBe('present')
    expect(f.writes).toEqual([])
  })
  it('recreates a placeholder when GearLever moved the file', () => {
    const f = fsWith(false)
    expect(recreateMissingAppImage('/apps/Axi.AppImage', 'linux', f.impl)).toBe('recreated')
    expect(f.writes).toEqual(['/apps/Axi.AppImage'])
  })
  it('reports failed without throwing', () => {
    const f = fsWith(false, true)
    expect(recreateMissingAppImage('/apps/Axi.AppImage', 'linux', f.impl)).toBe('failed')
  })
})

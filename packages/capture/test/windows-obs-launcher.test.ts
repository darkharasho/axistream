import { describe, it, expect } from 'vitest'
import { resolveWindowsObsExe } from '../src/windows-obs-launcher.js'

describe('resolveWindowsObsExe', () => {
  const env = {
    'ProgramFiles': 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    'LOCALAPPDATA': 'C:\\Users\\u\\AppData\\Local',
  }

  it('prefers the 64-bit Program Files install', () => {
    const exists = (p: string) => p === 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'
    expect(resolveWindowsObsExe(env, exists)).toBe('C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe')
  })

  it('falls back through x86 and LOCALAPPDATA', () => {
    const target = 'C:\\Users\\u\\AppData\\Local\\Programs\\obs-studio\\bin\\64bit\\obs64.exe'
    const exists = (p: string) => p === target
    expect(resolveWindowsObsExe(env, exists)).toBe(target)
  })

  it('returns null when OBS is not installed', () => {
    expect(resolveWindowsObsExe(env, () => false)).toBeNull()
  })

  it('tolerates missing env vars', () => {
    expect(resolveWindowsObsExe({}, () => false)).toBeNull()
  })
})

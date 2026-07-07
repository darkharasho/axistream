import { describe, it, expect, vi } from 'vitest'
import { unlockScript, runInputUnlock } from '../src/main/input-unlock.js'

describe('unlockScript', () => {
  it('pins the exact rule file, rule content, and udevadm sequence', () => {
    const s = unlockScript()
    expect(s).toContain('/etc/udev/rules.d/70-axistream-input.rules')
    expect(s).toContain('KERNEL=="event*", SUBSYSTEM=="input", TAG+="uaccess"')
    expect(s).toContain('udevadm control --reload-rules')
    expect(s).toContain('udevadm trigger --subsystem-match=input')
  })
})

describe('runInputUnlock', () => {
  it('runs the script via pkexec sh -c and reports success', async () => {
    const exec = vi.fn(async () => {})
    const r = await runInputUnlock(exec)
    expect(r).toEqual({ ok: true })
    expect(exec).toHaveBeenCalledWith('pkexec', ['sh', '-c', unlockScript()])
  })

  it('maps a cancelled/denied pkexec auth to a friendly message', async () => {
    for (const code of [126, 127]) {
      const exec = vi.fn(async () => { throw Object.assign(new Error(`exit ${code}`), { code }) })
      const r = await runInputUnlock(exec)
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/authorization was cancelled/i)
    }
  })

  it('passes other failures through as the error message', async () => {
    const exec = vi.fn(async () => { throw new Error('pkexec not found') })
    const r = await runInputUnlock(exec)
    expect(r).toEqual({ ok: false, error: 'pkexec not found' })
  })
})

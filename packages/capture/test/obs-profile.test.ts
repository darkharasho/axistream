import { describe, it, expect, vi } from 'vitest'
import { ensureCleanProfile } from '../src/obs-profile.js'

function client(list: { profiles: string[]; currentProfileName: string }) {
  const calls: Array<{ req: string; params?: object }> = []
  const call = vi.fn(async (req: string, params?: object) => {
    calls.push({ req, params })
    if (req === 'GetProfileList') return list as never
    return {} as never
  })
  return { call, calls }
}

describe('ensureCleanProfile', () => {
  it('creates the AxiStream profile and switches to it when absent', async () => {
    const c = client({ profiles: ['Untitled'], currentProfileName: 'Untitled' })
    const name = await ensureCleanProfile({ call: c.call })
    expect(name).toBe('AxiStream')
    expect(c.calls.map((x) => x.req)).toEqual(['GetProfileList', 'CreateProfile', 'SetCurrentProfile'])
    expect(c.calls[1].params).toEqual({ profileName: 'AxiStream' })
    expect(c.calls[2].params).toEqual({ profileName: 'AxiStream' })
  })

  it('switches without creating when the profile exists but is not current', async () => {
    const c = client({ profiles: ['Untitled', 'AxiStream'], currentProfileName: 'Untitled' })
    await ensureCleanProfile({ call: c.call })
    expect(c.calls.map((x) => x.req)).toEqual(['GetProfileList', 'SetCurrentProfile'])
  })

  it('does nothing when already on the AxiStream profile', async () => {
    const c = client({ profiles: ['AxiStream'], currentProfileName: 'AxiStream' })
    await ensureCleanProfile({ call: c.call })
    expect(c.calls.map((x) => x.req)).toEqual(['GetProfileList'])
  })

  it('returns null and never throws if a call keeps failing', async () => {
    const call = vi.fn(async () => { throw new Error('socket down') })
    expect(await ensureCleanProfile({ call, tries: 2, delayMs: 0 })).toBeNull()
    expect(call).toHaveBeenCalledTimes(2) // retried via callReady, then gave up
  })

  it('retries a transient failure then succeeds', async () => {
    let n = 0
    const call = vi.fn(async (req: string) => {
      if (req === 'GetProfileList') return { profiles: [], currentProfileName: 'Untitled' } as never
      if (req === 'CreateProfile') { n++; if (n < 2) throw new Error('code 600'); return {} as never }
      return {} as never
    })
    const name = await ensureCleanProfile({ call, tries: 5, delayMs: 0 })
    expect(name).toBe('AxiStream')
    expect(n).toBe(2) // first CreateProfile failed, retry succeeded
  })

  it('honors a custom profile name', async () => {
    const c = client({ profiles: [], currentProfileName: 'x' })
    const name = await ensureCleanProfile({ call: c.call, profileName: 'Custom' })
    expect(name).toBe('Custom')
    expect(c.calls[1].params).toEqual({ profileName: 'Custom' })
  })
})

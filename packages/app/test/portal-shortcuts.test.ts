import { describe, it, expect } from 'vitest'
import { createPortalShortcuts } from '../src/main/portal-shortcuts.js'

describe('createPortalShortcuts.available', () => {
  it('is false when the bus cannot be reached (no throw)', async () => {
    const portal = createPortalShortcuts(async () => { throw new Error('no session bus') })
    expect(await portal.available()).toBe(false)
  })

  it('reads the GlobalShortcuts version property when the bus works', async () => {
    const fakeIface = { Get: async () => ({ value: 2 }) }
    const portal = createPortalShortcuts(async () => ({
      getProxyObject: async () => ({ getInterface: () => fakeIface }),
      disconnect: () => {},
    }) as never)
    expect(await portal.available()).toBe(true)
  })
})

describe('createPortalShortcuts.bind', () => {
  // Scripted fake bus exercising the REAL handshake: match rule + raw
  // 'message' listener must be installed BEFORE each portal call resolves,
  // and Response signals arrive on the predictable request path (the portal
  // Request object does not exist ahead of the call — a proxy-based wait
  // regressed exactly here: "interface not found in proxy object").
  function fakeBus(responseCode = 0) {
    const matches: string[] = []
    let messageHandler: ((msg: unknown) => void) | null = null
    const emitted: string[] = []
    // The real token counter is module-global, so derive the request path
    // from the match rule the adapter just installed.
    const lastMatchPath = () => /path='([^']+)'/.exec(matches[matches.length - 1])?.[1]
    const respond = (results: Record<string, unknown>) => {
      const path = lastMatchPath()
      queueMicrotask(() => messageHandler?.({
        path,
        interface: 'org.freedesktop.portal.Request',
        member: 'Response',
        body: [responseCode, results],
      }))
    }
    const gsIface = {
      CreateSession: async () => { emitted.push('CreateSession'); respond({ session_handle: { value: '/session/handle/1' } }) },
      BindShortcuts: async () => { emitted.push('BindShortcuts'); respond({}) },
      on: () => {}, removeListener: () => {},
    }
    const bus = {
      name: ':1.42',
      _addMatch: async (r: string) => { matches.push(r) },
      _removeMatch: async () => {},
      on: (ev: string, cb: (msg: unknown) => void) => { if (ev === 'message') messageHandler = cb },
      removeListener: () => { messageHandler = null },
      getProxyObject: async () => ({ getInterface: () => gsIface }),
      disconnect: () => {},
    }
    return { bus, matches, emitted }
  }

  it('completes CreateSession\u2192BindShortcuts via raw match-rule Response waits', async () => {
    const f = fakeBus()
    const portal = createPortalShortcuts(async () => f.bus as never)
    const shortcut = await portal.bind('ptt', 'Push to talk', 'F18')
    expect(f.emitted).toEqual(['CreateSession', 'BindShortcuts'])
    expect(f.matches).toHaveLength(2)
    expect(f.matches[0]).toContain("member='Response'")
    expect(f.matches[0]).toContain('/org/freedesktop/portal/desktop/request/1_42/')
    await shortcut.close()
  })

  it('rejects with the denial code when the portal says no', async () => {
    const f = fakeBus(1)
    const portal = createPortalShortcuts(async () => f.bus as never)
    await expect(portal.bind('ptt', 'Push to talk', 'F18')).rejects.toThrow(/denied \(code 1\)/)
  })
})

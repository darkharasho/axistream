import { describe, it, expect } from 'vitest'
import { createPortalShortcuts } from '../src/main/portal-shortcuts.js'

// Scripted fake bus exercising the REAL handshake: match rule + raw
// 'message' listener must be installed BEFORE each portal call resolves,
// and Response signals arrive on the predictable request path (the portal
// Request object does not exist ahead of the call — a proxy-based wait
// regressed exactly here: "interface not found in proxy object").
function fakeBus(responseCode = 0) {
  const matches: string[] = []
  let messageHandler: ((msg: unknown) => void) | null = null
  const emitted: string[] = []
  const sessionHandle = '/session/handle/1'
  const calls: Record<string, unknown[][]> = { CreateSession: [], BindShortcuts: [] }
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = { Activated: [], Deactivated: [] }
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
  const bindShortcutsArgs: unknown[][] = []
  const gsIface = {
    CreateSession: async (...a: unknown[]) => { emitted.push('CreateSession'); calls.CreateSession.push(a); respond({ session_handle: { value: sessionHandle } }) },
    BindShortcuts: async (...a: unknown[]) => { emitted.push('BindShortcuts'); calls.BindShortcuts.push(a); bindShortcutsArgs.push(a); respond({}) },
    on: (ev: string, cb: (...args: unknown[]) => void) => { listeners[ev]?.push(cb) },
    removeListener: (ev: string, cb: (...args: unknown[]) => void) => {
      const arr = listeners[ev]
      if (!arr) return
      const i = arr.indexOf(cb)
      if (i >= 0) arr.splice(i, 1)
    },
  }
  const registryIface = {
    Register: async (appId: string) => { emitted.push(`Register:${appId}`) },
  }
  const bus = {
    name: ':1.42',
    _addMatch: async (r: string) => { matches.push(r) },
    _removeMatch: async () => {},
    on: (ev: string, cb: (msg: unknown) => void) => { if (ev === 'message') messageHandler = cb },
    removeListener: () => { messageHandler = null },
    getProxyObject: async () => ({ getInterface: (name: string) => (name === 'org.freedesktop.host.portal.Registry' ? registryIface : gsIface) }),
    disconnect: () => {},
  }
  return {
    bus, messageBus: bus, matches, emitted, bindShortcutsArgs, calls, sessionHandle,
    emitSignal: (member: 'Activated' | 'Deactivated', handle: string, id: string) => {
      listeners[member]?.forEach((cb) => cb(handle, id))
    },
  }
}

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
  it('completes CreateSession\u2192BindShortcuts via raw match-rule Response waits', async () => {
    const f = fakeBus()
    const portal = createPortalShortcuts(async () => f.bus as never)
    const shortcut = await portal.bind('ptt', 'Push to talk', { key: { code: 188, name: 'F18' }, modifier: null })
    // host app-id registration MUST precede any portal session call
    expect(f.emitted).toEqual(['Register:link.axi.axistream', 'CreateSession', 'BindShortcuts'])
    expect(f.matches).toHaveLength(2)
    expect(f.matches[0]).toContain("member='Response'")
    expect(f.matches[0]).toContain('/org/freedesktop/portal/desktop/request/1_42/')
    // key.name must reach the preferred_trigger Variant on the wire
    const shortcuts = f.bindShortcutsArgs[0][1] as Array<[string, Record<string, { value: unknown }>]>
    expect(shortcuts[0][1].preferred_trigger.value).toBe('F18')
    await shortcut.close()
  })

  it('a modifier prefixes the preferred_trigger hint', async () => {
    const f = fakeBus()
    const portal = createPortalShortcuts(async () => f.bus as never)
    const shortcut = await portal.bind('ptt', 'Push to talk', { key: { code: 188, name: 'F18' }, modifier: 'ctrl' })
    const shortcuts = f.bindShortcutsArgs[0][1] as Array<[string, Record<string, { value: unknown }>]>
    expect(shortcuts[0][1].preferred_trigger.value).toBe('CTRL+F18')
    await shortcut.close()
  })

  it('rejects with the denial code when the portal says no', async () => {
    const f = fakeBus(1)
    const portal = createPortalShortcuts(async () => f.bus as never)
    await expect(portal.bind('ptt', 'Push to talk', { key: { code: 188, name: 'F18' }, modifier: null })).rejects.toThrow(/denied \(code 1\)/)
  })
})

describe('portal bindAll', () => {
  it('creates ONE session and binds every spec in a single BindShortcuts call', async () => {
    const bus = fakeBus()
    const portal = createPortalShortcuts(async () => bus.messageBus as never)
    const set = await portal.bindAll([
      { id: 'ptt', description: 'Push to talk', binding: { key: { code: 188, name: 'F18' }, modifier: null } },
      { id: 'masks', description: 'Masks', binding: { key: { code: 183, name: 'F13' }, modifier: 'ctrl' } },
    ])

    expect(bus.calls.CreateSession).toHaveLength(1)
    expect(bus.calls.BindShortcuts).toHaveLength(1)
    const shortcuts = bus.calls.BindShortcuts[0][1] as [string, Record<string, { value: string }>][]
    expect(shortcuts.map((s) => s[0])).toEqual(['ptt', 'masks'])
    expect(shortcuts[1][1].preferred_trigger.value).toBe('CTRL+F13')
    await set.close()
  })

  it('routes Activated signals to the matching id and ignores other sessions', async () => {
    const bus = fakeBus()
    const set = await createPortalShortcuts(async () => bus.messageBus as never).bindAll([
      { id: 'ptt', description: 'Push to talk', binding: { key: { code: 188, name: 'F18' }, modifier: null } },
      { id: 'masks', description: 'Masks', binding: { key: { code: 183, name: 'F13' }, modifier: null } },
    ])
    const fired: string[] = []
    set.onActivated((id) => fired.push(id))

    bus.emitSignal('Activated', bus.sessionHandle, 'masks')
    bus.emitSignal('Activated', '/other/session', 'ptt')
    bus.emitSignal('Activated', bus.sessionHandle, 'unknown-id')

    expect(fired).toEqual(['masks'])
    await set.close()
  })
})

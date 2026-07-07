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

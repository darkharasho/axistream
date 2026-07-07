// packages/app/src/main/portal-shortcuts.ts
// The ONLY file that talks dbus. Implements the XDG GlobalShortcuts portal
// handshake (docs: org.freedesktop.portal.GlobalShortcuts, v2):
//   CreateSession -> (Response signal) -> BindShortcuts -> (Response signal)
//   -> Activated / Deactivated signals carry press/release edges.
// Request Response signals arrive on a PREDICTABLE path derived from our
// unique bus name + handle_token, so we proxy that path BEFORE calling the
// method (avoids the classic reply-before-subscribe race).
import dbus, { Variant, type MessageBus, type ClientInterface } from 'dbus-next'

const PORTAL_DEST = 'org.freedesktop.portal.Desktop'
const PORTAL_PATH = '/org/freedesktop/portal/desktop'
const GS_IFACE = 'org.freedesktop.portal.GlobalShortcuts'

export interface BoundShortcut { onActivated(cb: () => void): void; onDeactivated(cb: () => void): void; close(): Promise<void> }

let tokenCounter = 0
const nextToken = () => `axistream_${process.pid}_${++tokenCounter}`

// NOTE: bus.name is only populated after the Hello reply; every caller first
// awaits a getProxyObject on the same connection, which orders after Hello.
function requestPath(bus: MessageBus, token: string): string {
  // ':1.42' -> '1_42' per the portal spec's sender-path convention.
  // dbus-next's MessageBus has a runtime .name but the bundled .d.ts omits it.
  const sender = ((bus as unknown as { name?: string }).name ?? '').replace(/^:/, '').replace(/\./g, '_')
  return `/org/freedesktop/portal/desktop/request/${sender}/${token}`
}

async function awaitResponse(bus: MessageBus, token: string, call: () => Promise<unknown>): Promise<Record<string, Variant>> {
  const path = requestPath(bus, token)
  const obj = await bus.getProxyObject(PORTAL_DEST, path)
  const req = obj.getInterface('org.freedesktop.portal.Request')
  const response = new Promise<Record<string, Variant>>((resolve, reject) => {
    req.once('Response', (code: number, results: Record<string, Variant>) => {
      if (code === 0) resolve(results)
      else reject(new Error(`portal request denied (code ${code})`))
    })
  })
  await call()
  return response
}

export function createPortalShortcuts(busFactory: () => Promise<MessageBus> = async () => dbus.sessionBus()) {
  return {
    async available(): Promise<boolean> {
      let bus: MessageBus | null = null
      try {
        bus = await busFactory()
        const obj = await bus.getProxyObject(PORTAL_DEST, PORTAL_PATH)
        const props = obj.getInterface('org.freedesktop.DBus.Properties')
        const v = await props.Get(GS_IFACE, 'version') as Variant
        return Number(v.value) >= 1
      } catch {
        return false
      } finally {
        try { bus?.disconnect() } catch { /* ignore */ }
      }
    },

    async bind(id: string, description: string, preferredTrigger: string): Promise<BoundShortcut> {
      const bus = await busFactory()
      const obj = await bus.getProxyObject(PORTAL_DEST, PORTAL_PATH)
      const gs = obj.getInterface(GS_IFACE) as ClientInterface

      const sessionToken = nextToken()
      const createToken = nextToken()
      const createResults = await awaitResponse(bus, createToken, () => gs.CreateSession({
        handle_token: new Variant('s', createToken),
        session_handle_token: new Variant('s', sessionToken),
      }))
      const sessionHandle = String((createResults.session_handle as Variant).value)

      const bindToken = nextToken()
      await awaitResponse(bus, bindToken, () => gs.BindShortcuts(
        sessionHandle,
        [[id, { description: new Variant('s', description), preferred_trigger: new Variant('s', preferredTrigger) }]],
        '',
        { handle_token: new Variant('s', bindToken) },
      ))

      let onAct: (() => void) | null = null
      let onDeact: (() => void) | null = null
      const activated = (handle: string, shortcutId: string) => {
        if (handle === sessionHandle && shortcutId === id) onAct?.()
      }
      const deactivated = (handle: string, shortcutId: string) => {
        if (handle === sessionHandle && shortcutId === id) onDeact?.()
      }
      gs.on('Activated', activated)
      gs.on('Deactivated', deactivated)

      return {
        onActivated: (cb) => { onAct = cb },
        onDeactivated: (cb) => { onDeact = cb },
        close: async () => {
          gs.removeListener('Activated', activated)
          gs.removeListener('Deactivated', deactivated)
          try {
            const sess = await bus.getProxyObject(PORTAL_DEST, sessionHandle)
            await (sess.getInterface('org.freedesktop.portal.Session') as ClientInterface).Close()
          } catch { /* best-effort */ }
          try { bus.disconnect() } catch { /* ignore */ }
        },
      }
    },
  }
}

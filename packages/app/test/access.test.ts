// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfig, hashIdentity, type AxiConfig, type Identity } from '@axiapps/axi-config'
import { resetBlockScreenForTests } from '@axiapps/axi-config/electron'
import { startAccess, type AccessDeps } from '../src/main/access.js'

const quiet = { warn: () => {} }
const SERVER = '123456789012345678'
const WEBHOOK = 'https://discord.com/api/webhooks/111111111111111111/token-token'
const body = (denylist: string[]) =>
  new Response(JSON.stringify({ version: 1, flags: {}, minVersion: null, notice: null, denylist }), { status: 200, headers: { etag: '"v1"' } })

let dir: string
let configs: AxiConfig[] = []
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'axistream-access-')); resetBlockScreenForTests() })
afterEach(async () => {
  for (const c of configs) c.close()
  configs = []
  await rm(dir, { recursive: true, force: true })
})

function makeConfig(denylist: string[] | 'offline') {
  const fetchFn = (async () => {
    if (denylist === 'offline') throw new Error('offline')
    return body(denylist)
  }) as typeof fetch
  const c = createConfig({ appId: 'axistream', cacheDir: dir, url: 'https://cfg.test', fetch: fetchFn, logger: quiet })
  configs.push(c)
  return c
}

function fakeElectron() {
  const win = {
    isDestroyed: () => false, destroy: vi.fn(), removeMenu: vi.fn(), loadURL: vi.fn(async () => {}), on: vi.fn(),
    webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
  }
  const BrowserWindow = vi.fn(() => win) as unknown as AccessDeps['electron']['BrowserWindow']
  ;(BrowserWindow as unknown as { getAllWindows: () => unknown[] }).getAllWindows = () => []
  return {
    win,
    electron: {
      app: { quit: vi.fn(), on: vi.fn(), relaunch: vi.fn(), exit: vi.fn(), getPath: () => dir },
      BrowserWindow,
      shell: { openExternal: vi.fn(async () => {}) },
    } as unknown as AccessDeps['electron'],
  }
}

const serverIds = (id: string): Identity[] => [{ kind: 'discord_server', value: id }]

describe('axistream access check', () => {
  it('blocks at runtime when the webhook server is listed', async () => {
    const config = makeConfig([await hashIdentity('discord_server', SERVER)])
    await config.ready()
    await config.refresh()
    const onBlocked = vi.fn()
    const lookupWebhooks = vi.fn(async () => serverIds(SERVER))
    const boot = await startAccess({ electron: fakeElectron().electron, config, onBlocked, readWebhookUrl: () => WEBHOOK, lookupWebhooks })
    expect(boot.blocked).toBe(false)
    if (boot.blocked) return
    await boot.gate.recheck()
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(onBlocked).toHaveBeenCalledWith({ persisted: true })
    expect(lookupWebhooks).toHaveBeenCalledWith([WEBHOOK])
  })

  it('does not block clean identities', async () => {
    const config = makeConfig([await hashIdentity('discord_server', '999999999999999999')])
    await config.ready()
    await config.refresh()
    const onBlocked = vi.fn()
    const boot = await startAccess({ electron: fakeElectron().electron, config, onBlocked, readWebhookUrl: () => WEBHOOK, lookupWebhooks: async () => serverIds(SERVER) })
    if (boot.blocked) throw new Error('unexpected block')
    await boot.gate.recheck()
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('boots into the block screen when the sticky trip is set', async () => {
    const denylist = [await hashIdentity('discord_server', SERVER)]
    const first = makeConfig(denylist)
    await first.ready()
    await first.refresh()
    expect((await first.check(serverIds(SERVER))).blocked).toBe(true)
    first.close()

    const second = makeConfig(denylist)
    const { electron, win } = fakeElectron()
    const lookupWebhooks = vi.fn(async () => [])
    const boot = await startAccess({ electron, config: second, readWebhookUrl: () => WEBHOOK, lookupWebhooks })
    expect(boot).toEqual({ blocked: true })
    expect(win.loadURL).toHaveBeenCalledTimes(1)
    expect(lookupWebhooks).not.toHaveBeenCalled()
  })

  it('fails open when offline with no cache', async () => {
    const config = makeConfig('offline')
    const onBlocked = vi.fn()
    const boot = await startAccess({ electron: fakeElectron().electron, config, onBlocked, readWebhookUrl: () => WEBHOOK, lookupWebhooks: async () => serverIds(SERVER) })
    if (boot.blocked) throw new Error('unexpected block')
    await boot.gate.recheck()
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('skips the lookup when no webhook is configured', async () => {
    const config = makeConfig([])
    const lookupWebhooks = vi.fn(async () => [])
    const boot = await startAccess({ electron: fakeElectron().electron, config, onBlocked: vi.fn(), readWebhookUrl: () => '  ', lookupWebhooks })
    if (boot.blocked) throw new Error('unexpected block')
    await boot.gate.recheck()
    expect(lookupWebhooks).not.toHaveBeenCalled()
  })
})

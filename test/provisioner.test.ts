import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Provisioner } from '../src/provisioner.js'
import { CaptureConfig } from '../src/capture-config.js'

// A fake obs-websocket client whose `call` is scripted per request type.
function fakeClient(handlers: Record<string, (data?: any) => any>) {
  return {
    call: vi.fn(async (req: string, data?: any) => {
      const h = handlers[req]
      if (!h) throw new Error(`unexpected request ${req}`)
      return h(data)
    }),
  }
}

const bigVariedB64 = (() => {
  const buf = Buffer.alloc(5000)
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 37) % 251
  return 'data:image/png;base64,' + buf.toString('base64')
})()
const blackB64 = 'data:image/png;base64,' + Buffer.alloc(50, 0).toString('base64')

describe('Provisioner (Wayland)', () => {
  let dir: string, config: CaptureConfig
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axp-')); config = new CaptureConfig(join(dir, 'c.json')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('builds, reloads, fires onApprovalNeeded, and reaches READY on first non-black frame', async () => {
    const make = (screenshot: string) => fakeClient({
      GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
      CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
      CreateInput: () => ({}), RemoveInput: () => ({}), RemoveScene: () => ({}),
      CreateSceneCollection: () => ({}), SetCurrentSceneCollection: () => ({}),
      GetSceneList: () => ({ scenes: [] }),
      GetSourceScreenshot: () => ({ imageData: screenshot }),
    })
    let client = make(bigVariedB64)
    const sidecar = {
      client: () => client as any,
      restart: vi.fn(async () => { client = make(bigVariedB64) }),
    }
    const onApproval = vi.fn()
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'linux', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.provision(onApproval)

    expect(sidecar.restart).toHaveBeenCalledOnce()
    expect(onApproval).toHaveBeenCalledOnce()
    expect(res).toEqual({ ok: true, status: 'READY' })
    expect(config.isProvisioned()).toBe(true)
    expect(p.status()).toBe('READY')
  })

  it('stays AWAITING_APPROVAL and does not provision when frames stay black', async () => {
    const make = () => fakeClient({
      GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
      CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
      CreateInput: () => ({}), RemoveInput: () => ({}), RemoveScene: () => ({}),
      CreateSceneCollection: () => ({}), SetCurrentSceneCollection: () => ({}),
      GetSceneList: () => ({ scenes: [] }),
      GetSourceScreenshot: () => ({ imageData: blackB64 }),
    })
    let client = make()
    const sidecar = { client: () => client as any, restart: vi.fn(async () => { client = make() }) }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'linux', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.provision(vi.fn())
    expect(res).toEqual({ ok: false, status: 'AWAITING_APPROVAL' })
    expect(config.isProvisioned()).toBe(false)
  })
})

describe('Provisioner (Windows + repair)', () => {
  let dir: string, config: CaptureConfig
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axpw-')); config = new CaptureConfig(join(dir, 'c.json')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('windows path provisions live with no restart and no approval prompt', async () => {
    const client = fakeClient({
      GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
      GetInputList: () => ({ inputs: [] }),
      CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
      RemoveScene: () => ({}), CreateInput: () => ({}),
      GetSourceScreenshot: () => ({ imageData: bigVariedB64 }),
    })
    const sidecar = { client: () => client as any, restart: vi.fn() }
    const onApproval = vi.fn()
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'win32', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.provision(onApproval)
    expect(sidecar.restart).not.toHaveBeenCalled()
    expect(onApproval).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: true, status: 'READY' })
  })

  it('repair() runs the provision flow again', async () => {
    const client = fakeClient({
      GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
      GetInputList: () => ({ inputs: [] }),
      CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
      RemoveScene: () => ({}), CreateInput: () => ({}),
      GetSourceScreenshot: () => ({ imageData: bigVariedB64 }),
    })
    const sidecar = { client: () => client as any, restart: vi.fn() }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'win32', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.repair()
    expect(res.ok).toBe(true)
    expect(res.status).toBe('READY')
  })
})

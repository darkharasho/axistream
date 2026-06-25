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
    const calls: [string, any][] = []
    const make = (screenshot: string) => ({
      call: vi.fn(async (req: string, data?: any) => {
        calls.push([req, data])
        const handlers: Record<string, (d?: any) => any> = {
          GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
          CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
          CreateInput: () => ({}), RemoveInput: () => ({}), RemoveScene: () => ({}),
          CreateSceneCollection: () => ({}), SetCurrentSceneCollection: () => ({}),
          GetSceneList: () => ({ scenes: [] }),
          GetSourceScreenshot: () => ({ imageData: screenshot }),
          GetInputList: () => ({ inputs: [] }),
          SetInputMute: () => ({}),
          SetProfileParameter: () => ({}),
        }
        const h = handlers[req]
        if (!h) throw new Error(`unexpected request ${req}`)
        return h(data)
      }),
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

    // The restore token must be persisted to disk: SetCurrentSceneCollection('AxiStreamScratch')
    // must be called at least twice — once pre-restart (to save AxiStream before reload) and
    // once post-READY (to flush the runtime restore token after portal approval).
    const scratchSwitchCalls = calls.filter(
      ([req, data]) => req === 'SetCurrentSceneCollection' && data?.sceneCollectionName === 'AxiStreamScratch'
    )
    expect(scratchSwitchCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('stays AWAITING_APPROVAL and does not provision when frames stay black', async () => {
    const make = () => fakeClient({
      GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
      CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
      CreateInput: () => ({}), RemoveInput: () => ({}), RemoveScene: () => ({}),
      CreateSceneCollection: () => ({}), SetCurrentSceneCollection: () => ({}),
      GetSceneList: () => ({ scenes: [] }),
      GetSourceScreenshot: () => ({ imageData: blackB64 }),
      GetInputList: () => ({ inputs: [] }),
      SetInputMute: () => ({}),
      SetProfileParameter: () => ({}),
    })
    let client = make()
    const sidecar = { client: () => client as any, restart: vi.fn(async () => { client = make() }) }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'linux', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.provision(vi.fn())
    expect(res).toEqual({ ok: false, status: 'AWAITING_APPROVAL' })
    expect(config.isProvisioned()).toBe(false)
  })
})

describe('Provisioner (Wayland) – collection ensure', () => {
  let dir: string, config: CaptureConfig
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axpe-')); config = new CaptureConfig(join(dir, 'c.json')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates the collection when absent', async () => {
    const calls: [string, any][] = []
    const make = (screenshot: string) => ({
      call: vi.fn(async (req: string, data?: any) => {
        calls.push([req, data])
        const handlers: Record<string, (d?: any) => any> = {
          GetSceneCollectionList: () => ({ currentSceneCollectionName: 'Untitled', sceneCollections: ['Untitled'] }),
          CreateSceneCollection: () => ({}),
          SetCurrentSceneCollection: () => ({}),
          GetSceneList: () => ({ scenes: [] }),
          CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
          CreateInput: () => ({}), RemoveInput: () => ({}), RemoveScene: () => ({}),
          GetSourceScreenshot: () => ({ imageData: screenshot }),
          GetInputList: () => ({ inputs: [] }),
          SetInputMute: () => ({}),
          SetProfileParameter: () => ({}),
        }
        const h = handlers[req]
        if (!h) throw new Error(`unexpected request ${req}`)
        return h(data)
      }),
    })
    let client = make(bigVariedB64)
    const sidecar = {
      client: () => client as any,
      restart: vi.fn(async () => { client = make(bigVariedB64) }),
    }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'linux', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.provision()

    const createCollCalls = calls.filter(([req, data]) => req === 'CreateSceneCollection' && data?.sceneCollectionName === 'AxiStream')
    expect(createCollCalls.length).toBeGreaterThan(0)
    expect(res).toEqual({ ok: true, status: 'READY' })
  })

  it('switches when collection is present but not current', async () => {
    const calls: [string, any][] = []
    const make = (screenshot: string) => ({
      call: vi.fn(async (req: string, data?: any) => {
        calls.push([req, data])
        const handlers: Record<string, (d?: any) => any> = {
          GetSceneCollectionList: () => ({ currentSceneCollectionName: 'Untitled', sceneCollections: ['Untitled', 'AxiStream'] }),
          CreateSceneCollection: () => ({}),
          SetCurrentSceneCollection: () => ({}),
          GetSceneList: () => ({ scenes: [] }),
          CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
          CreateInput: () => ({}), RemoveInput: () => ({}), RemoveScene: () => ({}),
          GetSourceScreenshot: () => ({ imageData: screenshot }),
          GetInputList: () => ({ inputs: [] }),
          SetInputMute: () => ({}),
          SetProfileParameter: () => ({}),
        }
        const h = handlers[req]
        if (!h) throw new Error(`unexpected request ${req}`)
        return h(data)
      }),
    })
    let client = make(bigVariedB64)
    const sidecar = {
      client: () => client as any,
      restart: vi.fn(async () => { client = make(bigVariedB64) }),
    }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'linux', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.provision()

    // The ensure step must call SetCurrentSceneCollection, not CreateSceneCollection for AxiStream
    const ensureCreateCalls = calls.filter(([req, data], idx) =>
      req === 'CreateSceneCollection' && data?.sceneCollectionName === 'AxiStream' &&
      idx < calls.findIndex(([r]) => r === 'CreateScene')
    )
    expect(ensureCreateCalls.length).toBe(0)
    const switchCalls = calls.filter(([req, data]) => req === 'SetCurrentSceneCollection' && data?.sceneCollectionName === 'AxiStream')
    expect(switchCalls.length).toBeGreaterThan(0)
    expect(res).toEqual({ ok: true, status: 'READY' })
  })
})

describe('Provisioner (Windows + repair)', () => {
  let dir: string, config: CaptureConfig
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axpw-')); config = new CaptureConfig(join(dir, 'c.json')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('windows path provisions live with no restart and no approval prompt', async () => {
    const calls: [string, any][] = []
    const client = {
      call: vi.fn(async (req: string, data?: any) => {
        calls.push([req, data])
        const handlers: Record<string, (d?: any) => any> = {
          GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
          GetInputList: () => ({ inputs: [] }),
          CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
          RemoveScene: () => ({}), CreateInput: () => ({}),
          GetSourceScreenshot: () => ({ imageData: bigVariedB64 }),
          SetInputMute: () => ({}),
          SetProfileParameter: () => ({}),
        }
        const h = handlers[req]
        if (!h) throw new Error(`unexpected request ${req}`)
        return h(data)
      }),
    }
    const sidecar = { client: () => client as any, restart: vi.fn() }
    const onApproval = vi.fn()
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'win32', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.provision(onApproval)
    expect(sidecar.restart).not.toHaveBeenCalled()
    expect(onApproval).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: true, status: 'READY' })
    // Windows never creates SCRATCH and has no restore token — post-READY persist must NOT happen.
    const scratchSwitchCalls = calls.filter(
      ([req, data]) => req === 'SetCurrentSceneCollection' && data?.sceneCollectionName === 'AxiStreamScratch'
    )
    expect(scratchSwitchCalls.length).toBe(0)
  })

  it('repair() runs the provision flow again', async () => {
    const client = fakeClient({
      GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
      GetInputList: () => ({ inputs: [] }),
      CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
      RemoveScene: () => ({}), CreateInput: () => ({}),
      GetSourceScreenshot: () => ({ imageData: bigVariedB64 }),
      SetInputMute: () => ({}),
      SetProfileParameter: () => ({}),
    })
    const sidecar = { client: () => client as any, restart: vi.fn() }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'win32', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.repair()
    expect(res.ok).toBe(true)
    expect(res.status).toBe('READY')
  })
})

describe('Provisioner – audio provisioning', () => {
  let dir: string, config: CaptureConfig
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axpa-')); config = new CaptureConfig(join(dir, 'c.json')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('provisions desktop + muted mic audio inputs and AAC encoder', async () => {
    const calls: [string, any][] = []
    const client = {
      call: vi.fn(async (req: string, data?: any) => {
        calls.push([req, data])
        const handlers: Record<string, (d?: any) => any> = {
          GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
          GetInputList: () => ({ inputs: [] }),
          CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
          RemoveScene: () => ({}), CreateInput: () => ({}), RemoveInput: () => ({}),
          SetInputMute: () => ({}),
          SetProfileParameter: () => ({}),
          GetSourceScreenshot: () => ({ imageData: bigVariedB64 }),
        }
        const h = handlers[req]
        if (!h) throw new Error(`unexpected request ${req}`)
        return h(data)
      }),
    }
    const sidecar = { client: () => client as any, restart: vi.fn() }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'win32', approvalPollTries: 3, approvalPollDelayMs: 5 })
    await p.provision()

    const created = calls.filter(([req]) => req === 'CreateInput').map(([, data]) => data)
    expect(created).toEqual(expect.arrayContaining([
      expect.objectContaining({ inputName: 'AxiStream Desktop Audio', inputKind: 'pulse_output_capture' }),
      expect.objectContaining({ inputName: 'AxiStream Mic', inputKind: 'pulse_input_capture' }),
    ]))
    expect(calls.map(([req, data]) => ({ req, data }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ req: 'SetInputMute', data: { inputName: 'AxiStream Mic', inputMuted: true } }),
      expect.objectContaining({ req: 'SetProfileParameter', data: { parameterCategory: 'SimpleOutput', parameterName: 'ABitrate', parameterValue: '160' } }),
      expect.objectContaining({ req: 'SetProfileParameter', data: { parameterCategory: 'Audio', parameterName: 'SampleRate', parameterValue: '48000' } }),
      expect.objectContaining({ req: 'SetProfileParameter', data: { parameterCategory: 'Audio', parameterName: 'ChannelSetup', parameterValue: 'Stereo' } }),
    ]))
  })

  it('skips creating audio inputs that already exist (idempotency)', async () => {
    const calls: [string, any][] = []
    const client = {
      call: vi.fn(async (req: string, data?: any) => {
        calls.push([req, data])
        const handlers: Record<string, (d?: any) => any> = {
          GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
          GetInputList: () => ({ inputs: [
            { inputName: 'AxiStream Desktop Audio' },
            { inputName: 'AxiStream Mic' },
          ] }),
          CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
          RemoveScene: () => ({}), CreateInput: () => ({}), RemoveInput: () => ({}),
          SetInputMute: () => ({}),
          SetProfileParameter: () => ({}),
          GetSourceScreenshot: () => ({ imageData: bigVariedB64 }),
        }
        const h = handlers[req]
        if (!h) throw new Error(`unexpected request ${req}`)
        return h(data)
      }),
    }
    const sidecar = { client: () => client as any, restart: vi.fn() }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'win32', approvalPollTries: 3, approvalPollDelayMs: 5 })
    await p.provision()

    const audioCreates = calls.filter(([req, data]) =>
      req === 'CreateInput' && (data?.inputName === 'AxiStream Desktop Audio' || data?.inputName === 'AxiStream Mic')
    )
    expect(audioCreates.length).toBe(0)
  })

  it('audio failure does not abort provisioning (best-effort)', async () => {
    const calls: [string, any][] = []
    const client = {
      call: vi.fn(async (req: string, data?: any) => {
        calls.push([req, data])
        const handlers: Record<string, (d?: any) => any> = {
          GetSceneCollectionList: () => ({ currentSceneCollectionName: 'AxiStream', sceneCollections: ['AxiStream'] }),
          GetInputList: () => { throw new Error('OBS audio error') },
          CreateScene: () => ({}), SetCurrentProgramScene: () => ({}),
          RemoveScene: () => ({}), CreateInput: () => ({}), RemoveInput: () => ({}),
          GetSourceScreenshot: () => ({ imageData: bigVariedB64 }),
        }
        const h = handlers[req]
        if (!h) throw new Error(`unexpected request ${req}`)
        return h(data)
      }),
    }
    const sidecar = { client: () => client as any, restart: vi.fn() }
    const p = new Provisioner({ sidecar: sidecar as any, config, platform: 'win32', approvalPollTries: 3, approvalPollDelayMs: 5 })
    const res = await p.provision()
    // Provisioning must still succeed even though audio setup failed
    expect(res).toEqual({ ok: true, status: 'READY' })
  })
})

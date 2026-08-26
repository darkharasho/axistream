import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HotkeyService, END_STREAM_CONFIRM_MS } from '../src/main/HotkeyService.js'

const F13 = { code: 183, name: 'F13' }

function harness(over: Record<string, unknown> = {}) {
  let now = 1000
  const toasts: { kind: string; message: string }[] = []
  const actions = {
    phase: () => 'READY',
    micEnabled: () => true,
    masksVisible: () => true,
    recordingActive: () => false,
    pttEnabled: () => false,
    goLive: vi.fn(async () => {}),
    stopStream: vi.fn(async () => {}),
    setMicEnabled: vi.fn(async () => {}),
    setMasksVisible: vi.fn(async () => {}),
    startRecording: vi.fn(async () => ({ ok: true })),
    stopRecording: vi.fn(async () => ({ ok: true })),
    toast: (kind: string, message: string) => { toasts.push({ kind, message }) },
    ...over,
  }
  const svc = new HotkeyService({
    selectBackend: async () => ({ backend: { available: async () => true, bindAll: async () => ({ onActivated() {}, onDeactivated() {}, close: async () => {} }) }, mode: 'passthrough' }),
    bindings: () => ({ goLive: { key: F13, modifier: null }, micMute: null, masks: null, record: null }),
    pttBinding: () => null,
    actions: actions as never,
    onPttEdge: () => {},
    onMode: () => {},
    now: () => now,
  })
  return { svc, actions, toasts, advance: (ms: number) => { now += ms } }
}

describe('goLive hotkey', () => {
  it('goes live from READY', async () => {
    const h = harness()
    await h.svc.fire('goLive')
    expect(h.actions.goLive).toHaveBeenCalledOnce()
  })

  it('never opens a modal or fires from a blocked phase — it toasts the blocker', async () => {
    const h = harness({ phase: () => 'NEEDS_YOUTUBE' })
    await h.svc.fire('goLive')
    expect(h.actions.goLive).not.toHaveBeenCalled()
    expect(h.toasts[0].message).toMatch(/connect youtube/i)
  })

  it('toasts rather than acting while already going live', async () => {
    const h = harness({ phase: () => 'GOING_LIVE' })
    await h.svc.fire('goLive')
    expect(h.actions.goLive).not.toHaveBeenCalled()
    expect(h.actions.stopStream).not.toHaveBeenCalled()
  })

  it('requires a confirming second press to end a live stream', async () => {
    const h = harness({ phase: () => 'LIVE' })
    await h.svc.fire('goLive')
    expect(h.actions.stopStream).not.toHaveBeenCalled()
    expect(h.toasts[0].message).toMatch(/again/i)

    await h.svc.fire('goLive')
    expect(h.actions.stopStream).toHaveBeenCalledOnce()
  })

  it('lets the confirmation window expire', async () => {
    const h = harness({ phase: () => 'LIVE' })
    await h.svc.fire('goLive')
    h.advance(END_STREAM_CONFIRM_MS + 1)
    await h.svc.fire('goLive')
    expect(h.actions.stopStream).not.toHaveBeenCalled()
  })

  it('ends from RECONNECTING too', async () => {
    const h = harness({ phase: () => 'RECONNECTING' })
    await h.svc.fire('goLive')
    await h.svc.fire('goLive')
    expect(h.actions.stopStream).toHaveBeenCalledOnce()
  })

  it('resets the confirmation window when another action fires', async () => {
    const h = harness({ phase: () => 'LIVE' })
    await h.svc.fire('goLive')
    await h.svc.fire('masks')
    await h.svc.fire('goLive')
    expect(h.actions.stopStream).not.toHaveBeenCalled()
  })
})

describe('micMute hotkey', () => {
  it('toggles the mic', async () => {
    const h = harness({ micEnabled: () => true })
    await h.svc.fire('micMute')
    expect(h.actions.setMicEnabled).toHaveBeenCalledWith(false)
  })

  it('is inert while push-to-talk owns the mic', async () => {
    const h = harness({ pttEnabled: () => true })
    await h.svc.fire('micMute')
    expect(h.actions.setMicEnabled).not.toHaveBeenCalled()
    expect(h.toasts[0].message).toMatch(/push-to-talk/i)
  })
})

describe('masks hotkey', () => {
  it('toggles mask visibility', async () => {
    const h = harness({ masksVisible: () => true })
    await h.svc.fire('masks')
    expect(h.actions.setMasksVisible).toHaveBeenCalledWith(false)
  })
})

describe('record hotkey', () => {
  it('starts when idle and stops when active', async () => {
    const idle = harness({ recordingActive: () => false })
    await idle.svc.fire('record')
    expect(idle.actions.startRecording).toHaveBeenCalledOnce()

    const active = harness({ recordingActive: () => true })
    await active.svc.fire('record')
    expect(active.actions.stopRecording).toHaveBeenCalledOnce()
  })

  it('surfaces a refusal from the record gate as a toast', async () => {
    const h = harness({ startRecording: vi.fn(async () => ({ ok: false, error: 'An audio test is running' })) })
    await h.svc.fire('record')
    expect(h.toasts.at(-1)!.kind).toBe('error')
    expect(h.toasts.at(-1)!.message).toMatch(/audio test/i)
  })
})

describe('failure containment', () => {
  it('never lets a handler rejection escape', async () => {
    const h = harness({ setMasksVisible: vi.fn(async () => { throw new Error('obs died') }) })
    await expect(h.svc.fire('masks')).resolves.toBeUndefined()
    expect(h.toasts.at(-1)!.kind).toBe('error')
  })
})

describe('rebuild', () => {
  it('binds only the actions that have a binding, plus ptt when set', async () => {
    const specs: unknown[] = []
    const svc = new HotkeyService({
      selectBackend: async () => ({
        backend: {
          available: async () => true,
          bindAll: async (s: unknown[]) => { specs.push(...s); return { onActivated() {}, onDeactivated() {}, close: async () => {} } },
        },
        mode: 'exclusive',
      }),
      bindings: () => ({ goLive: { key: F13, modifier: null }, micMute: null, masks: null, record: null }),
      pttBinding: () => ({ key: { code: 188, name: 'F18' }, modifier: null }),
      actions: {} as never,
      onPttEdge: () => {},
      onMode: () => {},
      now: () => 0,
    })

    const r = await svc.rebuild()

    expect(r.ok).toBe(true)
    expect((specs as { id: string }[]).map((s) => s.id).sort()).toEqual(['goLive', 'ptt'])
  })

  it('is a no-op that reports ok when nothing is bound at all', async () => {
    const bindAll = vi.fn()
    const svc = new HotkeyService({
      selectBackend: async () => ({ backend: { available: async () => true, bindAll } as never, mode: 'passthrough' }),
      bindings: () => ({ goLive: null, micMute: null, masks: null, record: null }),
      pttBinding: () => null,
      actions: {} as never,
      onPttEdge: () => {},
      onMode: () => {},
      now: () => 0,
    })

    expect((await svc.rebuild()).ok).toBe(true)
    expect(bindAll).not.toHaveBeenCalled()
  })

  it('reports a bind failure without throwing', async () => {
    const svc = new HotkeyService({
      selectBackend: async () => ({ backend: { available: async () => true, bindAll: async () => { throw new Error('portal denied') } }, mode: 'exclusive' }),
      bindings: () => ({ goLive: { key: F13, modifier: null }, micMute: null, masks: null, record: null }),
      pttBinding: () => null,
      actions: {} as never,
      onPttEdge: () => {},
      onMode: () => {},
      now: () => 0,
    })

    const r = await svc.rebuild()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/portal denied/)
  })
})

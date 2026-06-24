import { describe, it, expect, vi } from 'vitest'
import { createStore } from '../src/renderer/store.js'
import { INITIAL_STATE } from '../src/shared/state.js'

describe('store', () => {
  it('starts at INITIAL_STATE', () => {
    expect(createStore().getState()).toEqual(INITIAL_STATE)
  })
  it('applyState merges a partial and notifies subscribers', () => {
    const s = createStore()
    const sub = vi.fn()
    s.subscribe(sub)
    s.applyState({ phase: 'READY', keyMasked: '····7f3a' })
    expect(s.getState().phase).toBe('READY')
    expect(s.getState().keyMasked).toBe('····7f3a')
    expect(sub).toHaveBeenCalledOnce()
  })
  it('applyStats updates stats slice', () => {
    const s = createStore()
    s.applyStats({ bitrateKbps: 6000, droppedFrames: 0, durationMs: 1000, encoder: 'x264', cpuPct: 10, reconnecting: false })
    expect(s.getState().stats?.bitrateKbps).toBe(6000)
  })
  it('applyPreview stores the latest frame without touching AppState', () => {
    const s = createStore()
    s.applyPreview('data:image/png;base64,AAAA')
    expect(s.getPreview()).toBe('data:image/png;base64,AAAA')
    expect(s.getState().phase).toBe('SETTING_UP')
  })
})

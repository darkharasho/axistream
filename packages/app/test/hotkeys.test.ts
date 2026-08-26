import { describe, it, expect } from 'vitest'
import {
  HOTKEY_IDS, HOTKEY_LABELS, DEFAULT_HOTKEYS,
  toBinding, toPersisted, findConflict,
} from '../src/shared/hotkeys.js'

const F13 = { code: 183, name: 'F13' }
const F14 = { code: 184, name: 'F14' }

describe('hotkey registry', () => {
  it('exposes exactly the four spec actions, in a stable order', () => {
    expect(HOTKEY_IDS).toEqual(['goLive', 'micMute', 'masks', 'record'])
  })

  it('labels every id', () => {
    for (const id of HOTKEY_IDS) expect(HOTKEY_LABELS[id]).toBeTruthy()
  })

  it('defaults every action to unbound', () => {
    for (const id of HOTKEY_IDS) expect(DEFAULT_HOTKEYS[id]).toBeNull()
  })
})

describe('toBinding', () => {
  it("converts the persisted empty-string modifier to null", () => {
    expect(toBinding({ code: 183, name: 'F13', modifier: '' }))
      .toEqual({ key: F13, modifier: null })
  })

  it('preserves a real modifier', () => {
    expect(toBinding({ code: 183, name: 'F13', modifier: 'ctrl' }))
      .toEqual({ key: F13, modifier: 'ctrl' })
  })

  it('passes null through', () => {
    expect(toBinding(null)).toBeNull()
  })
})

describe('toPersisted', () => {
  it("converts a null modifier to the empty string", () => {
    expect(toPersisted({ key: F13, modifier: null }))
      .toEqual({ code: 183, name: 'F13', modifier: '' })
  })

  it('round-trips through toBinding', () => {
    const b = { key: F14, modifier: 'alt' as const }
    expect(toBinding(toPersisted(b))).toEqual(b)
  })

  it('passes null through', () => {
    expect(toPersisted(null)).toBeNull()
  })
})

describe('findConflict', () => {
  const bindings = {
    goLive: { key: F13, modifier: null },
    micMute: null,
    masks: null,
    record: null,
  }
  const ptt = { key: F14, modifier: null }

  it('names the action already holding the key', () => {
    expect(findConflict('masks', { key: F13, modifier: null }, bindings, ptt))
      .toBe(HOTKEY_LABELS.goLive)
  })

  it('names push-to-talk when the key is its binding', () => {
    expect(findConflict('masks', { key: F14, modifier: null }, bindings, ptt))
      .toBe('Push to talk')
  })

  it('allows rebinding an action to the key it already holds', () => {
    expect(findConflict('goLive', { key: F13, modifier: null }, bindings, ptt)).toBeNull()
  })

  it('treats a differing modifier as a different binding', () => {
    expect(findConflict('masks', { key: F13, modifier: 'ctrl' }, bindings, ptt)).toBeNull()
  })

  it('returns null when nothing holds the key', () => {
    expect(findConflict('masks', { key: { code: 185, name: 'F15' }, modifier: null }, bindings, ptt))
      .toBeNull()
  })
})

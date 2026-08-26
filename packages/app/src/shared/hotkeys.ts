// packages/app/src/shared/hotkeys.ts
// The action registry for global hotkeys. Pure data plus pure functions —
// imported by main, preload, and renderer alike, so nothing here may touch
// node, electron, or DOM APIs.
import type { PttBinding, PttKey, PttModifier } from './keys.js'

export type HotkeyId = 'goLive' | 'micMute' | 'masks' | 'record'

/** Stable order — the Settings rows render in exactly this sequence. */
export const HOTKEY_IDS: HotkeyId[] = ['goLive', 'micMute', 'masks', 'record']

export const HOTKEY_LABELS: Record<HotkeyId, string> = {
  goLive: 'Go live / End stream',
  micMute: 'Mic mute',
  masks: 'Masks',
  record: 'Record',
}

/** Shown to the user by the portal's own shortcut UI (KDE lists these in its
 *  approval dialog and its global-shortcuts settings page). */
export const HOTKEY_DESCRIPTIONS: Record<HotkeyId, string> = {
  goLive: 'Start streaming, or end the stream',
  micMute: 'Mute or unmute the microphone',
  masks: 'Show or hide privacy masks',
  record: 'Start or stop a local recording',
}

/** In-memory binding. Structurally identical to PttBinding on purpose: that is
 *  what lets one backend call carry push-to-talk and the four actions in the
 *  same array. */
export interface Binding { key: PttKey; modifier: PttModifier | null }

/** On-disk binding. The empty-string modifier follows push-to-talk's existing
 *  settings convention — see toBinding/toPersisted for the boundary. */
export interface PersistedBinding {
  code: number
  name: string
  modifier: '' | PttModifier
}

/** The contract every backend implements. Declared here, once, so the three
 *  backends and HotkeyService cannot drift apart. `id` is a plain string
 *  because the push-to-talk slot ('ptt') is not a HotkeyId. */
export interface BindSpec { id: string; description: string; binding: Binding }
export interface BoundSet {
  onActivated(cb: (id: string) => void): void
  onDeactivated(cb: (id: string) => void): void
  close(): Promise<void>
}
export interface HotkeyBackend {
  available(): Promise<boolean>
  bindAll(specs: BindSpec[]): Promise<BoundSet>
}

export type HotkeyBindings = Record<HotkeyId, Binding | null>
export type PersistedHotkeys = Record<HotkeyId, PersistedBinding | null>

/** Nothing is bound out of the box: any default risks silently taking a key
 *  away from Guild Wars 2, and on the portal backend the user has no way to
 *  connect a dead skill key back to AxiStream. */
export const DEFAULT_HOTKEYS: PersistedHotkeys = {
  goLive: null, micMute: null, masks: null, record: null,
}

export function toBinding(p: PersistedBinding | null): Binding | null {
  if (!p) return null
  return { key: { code: p.code, name: p.name }, modifier: p.modifier === '' ? null : p.modifier }
}

export function toPersisted(b: Binding | null): PersistedBinding | null {
  if (!b) return null
  return { code: b.key.code, name: b.key.name, modifier: b.modifier ?? '' }
}

const sameBinding = (a: Binding, b: Binding) => a.key.code === b.key.code && a.modifier === b.modifier

/** The label of whatever already holds this key, or null if it is free.
 *  Rebinding an action to the key it already holds is not a conflict. */
export function findConflict(
  id: HotkeyId,
  binding: Binding,
  bindings: HotkeyBindings,
  ptt: PttBinding | null,
): string | null {
  for (const other of HOTKEY_IDS) {
    if (other === id) continue
    const held = bindings[other]
    if (held && sameBinding(held, binding)) return HOTKEY_LABELS[other]
  }
  if (ptt && sameBinding(ptt, binding)) return 'Push to talk'
  return null
}

/** The inverse direction from findConflict: the label of whichever hotkey
 *  ACTION already holds this binding, or null if none does. Guards a NEW
 *  push-to-talk binding against the four action hotkeys (findConflict guards
 *  an action's candidate binding against the other actions + the existing
 *  ptt binding — this is the missing PTT-against-actions leg). */
export function findActionOwner(binding: Binding, bindings: HotkeyBindings): string | null {
  for (const id of HOTKEY_IDS) {
    const held = bindings[id]
    if (held && sameBinding(held, binding)) return HOTKEY_LABELS[id]
  }
  return null
}

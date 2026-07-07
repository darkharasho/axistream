# Push to Talk (App-Owned, Wayland-Proof) — Design

**Date:** 2026-07-07
**Status:** Approved (design); pending implementation plan
**Scope:** Hold a global key (default F18) → mic audible everywhere (Discord
+ the AxiStream stream); release → muted everywhere. Implemented entirely by
AxiStream — no reliance on OBS's or Discord's Linux PTT, both of which are
broken/shaky under Wayland.

## Purpose & core idea

Global hotkeys are the thing Wayland broke for OBS and Discord. Two insights
make an app-owned PTT robust:

1. **Capture:** the XDG **GlobalShortcuts portal** is the Wayland-native way
   to receive global key press AND release events (`Activated` /
   `Deactivated` signals), focus-independent and permissionless. Verified
   live on the user's KDE Wayland session (portal v2). This is precisely the
   API Discord/OBS don't use.
2. **Gate:** mute the mic at the **PipeWire source level**
   (`pactl set-source-mute`). One mute point upstream of every consumer —
   Discord, the OBS mic input, everything — follows automatically. No
   Discord integration at all.

**Trade-off (stated in the UI):** Discord must be set to **Voice Activity**
mode — AxiStream owns the one true mute; Discord simply never hears audio
until the key is held.

## Non-goals

- Tap-to-latch/toggle mode (v1 is hold-to-talk only).
- In-app key rebinding UI. The binding lives in the portal/KDE (System
  Settings → Shortcuts → AxiStream); we register preferred trigger F18.
- evdev (`/dev/input`) capture — documented future fallback for desktops
  without the portal; needs `input`-group membership, out of v1 scope.
- X11 support beyond whatever the portal provides there; Windows/macOS.
- Talk-while-muted indicators, sounds, or overlays beyond the settings pill.

## Architecture

| Unit | Responsibility |
|------|----------------|
| `PttController.ts` (new, app main) | the whole feature: portal session + shortcut binding via injected dbus deps; press/release → source unmute/mute via injected exec; enable/disable/restore lifecycle; `onActive` callback for UI state. Best-effort, never throws out. |
| `portal-shortcuts.ts` (new, app main) | thin dbus-next adapter implementing the `PortalDeps` interface the controller consumes (session bus, CreateSession/BindShortcuts request-response dance, signal subscription). The only file that imports `dbus-next`. |
| `StreamSettings.ts` (extend) | `pttEnabled: boolean` (default `false`), sanitized like other booleans. |
| `state.ts` / `ipc.ts` / preload (extend) | `setPttEnabled(enabled)`, `AppState.ptt: { available: boolean; enabled: boolean; active: boolean }`, pushed via the existing state channel. |
| `index.ts` (extend) | construct the controller with real deps; boot-time restore + availability probe; wire IPC; quit-time restore. |
| `AudioSettings.tsx` (extend) | PTT toggle (gated on mic enabled + availability), TRANSMITTING/muted pill, the Discord voice-activity note, KDE rebinding hint. |

### PttController

```ts
export interface PortalShortcut { onActivated(cb: () => void): void; onDeactivated(cb: () => void): void; close(): Promise<void> }
export interface PortalDeps {
  available(): Promise<boolean>
  bind(id: string, description: string, preferredTrigger: string): Promise<PortalShortcut>  // rejects on portal/bind failure
}
export interface ExecLike { (cmd: string, args: string[]): Promise<void> }   // execFile wrapper, rejects on nonzero
export interface PttDeps {
  portal: PortalDeps
  exec: ExecLike
  sourceId(): string   // the pulse source to gate: app's micDevice, or '@DEFAULT_SOURCE@' when 'default'/null
  onActive(active: boolean): void   // UI push
}

export class PttController {
  constructor(d: PttDeps) {}
  async available(): Promise<boolean>            // portal.available(), cached, false on error
  async enable(): Promise<{ ok: boolean; error?: string }>   // bind shortcut, mute source, wire signals
  async disable(): Promise<void>                 // close shortcut, UNMUTE source (never leave the user muted)
  async restore(): Promise<void>                 // boot/quit safety: unmute source if we might have muted it
  isEnabled(): boolean
}
```

Behaviour:

- `enable()`: `portal.bind('ptt', 'Push to talk', 'F18')` → on success
  `setMute(true)` (PTT baseline = muted), wire `onActivated` →
  `setMute(false); onActive(true)` and `onDeactivated` → `setMute(true);
  onActive(false)`. Bind rejection → `{ ok: false, error }`, nothing muted.
- `setMute(m)`: `exec('pactl', ['set-source-mute', sourceId(), m ? '1' : '0'])`,
  failures `console.warn`ed and swallowed (a missed unmute is recovered by
  the next press/release edge or disable/restore).
- `disable()`: close the portal shortcut (best-effort), `setMute(false)`,
  `onActive(false)`.
- `restore()`: unconditionally `setMute(false)` — called at app boot (crash
  recovery: a previous run may have died with the source muted) and at app
  quit while enabled. Harmless when nothing was muted.
- Re-entrancy: `enable()` when already enabled is a no-op `{ ok: true }`;
  `disable()` when disabled is a no-op.

### portal-shortcuts.ts (dbus adapter)

Wraps `dbus-next` (pure-JS, no native addon — a new prod dependency of
`@axistream/app`). Implements the GlobalShortcuts handshake:

- `available()`: read the `version` property of
  `org.freedesktop.portal.GlobalShortcuts` on
  `org.freedesktop.portal.Desktop`; false on any error.
- `bind()`: `CreateSession` (with `handle_token` / `session_handle_token`
  options; await the `Response` signal on the returned request handle) →
  `BindShortcuts(session, [[id, { description, preferred_trigger }]], '', {})`
  (await its `Response`) → subscribe the portal's `Activated` /
  `Deactivated` signals filtered to our session handle + shortcut id.
  KDE persists the binding per app; the user can rebind in System Settings.
- `close()`: `Close` on the session; drop signal handlers.

### Settings, IPC, state

- `StreamSettingsData.pttEnabled: boolean`, default `false`,
  sanitized `typeof raw.pttEnabled === 'boolean' ? … : false`. NOT exposed on
  `StreamSettingsView` (it's not a YouTube setting); flows through `AppState.ptt`.
- `AppState.ptt: { available: boolean; enabled: boolean; active: boolean; error: string | null }`
  (INITIAL_STATE: `{ available: false, enabled: false, active: false, error: null }`),
  updated via the existing `setState` push.
- IPC: `setPttEnabled(enabled: boolean): Promise<void>` — persists the
  setting, calls `enable()`/`disable()`, updates state (enable failure →
  state stays disabled with `ptt.error` set; success clears it).
- Boot: probe `available()` → state; `restore()` always; if
  `pttEnabled && available` → `enable()` (re-arm across restarts).
- Quit (`win.on('close')` teardown): if enabled → `restore()`.

### UI (AudioSettings.tsx, under the Microphone block)

- Row visible only when `audio.micEnabled`; toggle disabled when
  `!ptt.available` (hint: "Needs the GlobalShortcuts portal — available on
  KDE Plasma").
- Checkbox "Push to talk (hold F18)" → `setPttEnabled`.
- When enabled: a pill — 🔴 **TRANSMITTING** while `ptt.active`, "muted —
  hold F18 to talk" otherwise.
- The trade-off note, verbatim intent: "AxiStream mutes your mic at the
  system level and unmutes it while the key is held. Set Discord to **Voice
  Activity** (not Push to Talk) — it follows automatically."
- Rebind hint: "Change the key in KDE System Settings → Shortcuts →
  AxiStream."

## Error handling

Every layer best-effort: portal absent → toggle disabled, feature inert;
bind rejected → readable error in the UI, source untouched; pactl failure →
warned, recovered at the next edge/disable/boot; nothing PTT-side may ever
block boot, go-live, or streaming. The source is left UNMUTED by disable,
quit, and boot-restore — the failure mode is "mic hot", never "user
inexplicably silent in Discord after closing AxiStream".

## Testing

- **PttController** (injected deps): enable binds then mutes; press/release
  edges unmute/mute + fire `onActive`; disable closes + unmutes; restore
  unmutes; bind rejection → `{ ok: false }` and NO mute call; exec failures
  swallowed; re-entrancy no-ops.
- **portal-shortcuts**: review-verified against the portal spec (no dbus in
  the test harness); `available()` false-on-error unit-tested with an
  injected bus stub if the adapter exposes one, else review-only.
- **StreamSettings**: `pttEnabled` default false, round-trip, non-boolean
  sanitizes to false.
- **AudioSettings**: row hidden without mic; toggle disabled when
  unavailable; toggle calls `setPttEnabled`; TRANSMITTING pill follows
  `ptt.active`; note text present.
- **Manual smoke** (user): enable PTT → Discord (voice activity) silent until
  F18 held, voice while held; Test audio clip contains voice only while F18
  held; close AxiStream → mic unmuted again system-wide; rebind in KDE works.

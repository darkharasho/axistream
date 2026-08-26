// packages/app/src/main/rebuild-hotkeys.ts
// Pure decision logic for one hotkey-session rebuild, extracted so the
// push-to-talk mic-hot invariant has direct unit coverage without booting
// all of index.ts (which owns the real HotkeyService/PttController wiring).
export interface RebuildHotkeysDeps {
  rebuild(): Promise<{ ok: boolean; error?: string }>
  pttEnabled(): boolean
  armPtt(): Promise<void>
  disarmPtt(): Promise<void>
}

// Push-to-talk's failure mode is always "mic hot": a failed rebuild means no
// watcher is live to ever deliver an unmute edge, so arming (and
// baseline-muting) on failure would strand the mic muted for the rest of the
// session with nothing left to unmute it. On success, arm only when the user
// actually wants PTT on. On failure, always disarm — a no-op if PTT was
// never armed, but essential when a PREVIOUS successful rebuild left it
// armed+muted and THIS rebuild is the one that lost the session.
export async function rebuildHotkeys(d: RebuildHotkeysDeps): Promise<{ ok: boolean; error?: string }> {
  const r = await d.rebuild()
  if (r.ok && d.pttEnabled()) await d.armPtt()
  else if (!r.ok) await d.disarmPtt()
  return r
}

export interface PttStateFields {
  enabled: boolean
  active: false
  error: string | null
  mode: 'passthrough' | 'exclusive' | null
}

// Pure derivation of the post-rebuild state.ptt patch (minus the key-label
// fields, which the caller already has). MUST gate `error` on the user's
// INTENT (wantsPtt = settings.pttEnabled), not on `armed` — a failed
// rebuild always disarms PTT (see rebuildHotkeys above), so gating on the
// post-rebuild armed state would make a bind-failure error permanently
// unreachable: the one case that needs to report it is exactly the case
// that rebuildHotkeys just disarmed.
export function pttStateFields(
  r: { ok: boolean; error?: string },
  opts: { armed: boolean; wantsPtt: boolean; mode: 'passthrough' | 'exclusive' | null },
): PttStateFields {
  return {
    enabled: opts.armed,
    active: false,
    error: opts.wantsPtt ? (r.ok ? null : (r.error ?? 'failed')) : null,
    mode: opts.armed ? opts.mode : null,
  }
}

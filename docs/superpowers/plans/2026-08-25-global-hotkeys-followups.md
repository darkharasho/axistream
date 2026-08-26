# Global hotkeys — parked follow-ups

Findings surfaced during review of `feat/global-hotkeys` that were
deliberately ruled out of scope. Each was verified against the merged code,
not just reported. None is a blocker; they are recorded here so the reasoning
survives.

## 1. `setPttBinding` has no PTT-vs-action conflict guard

`capturePttKey` refuses a key already owned by an action (`findActionOwner`),
but `setPttBinding` patches and rebuilds with no such check. Deferred because
the handler returns `Promise<void>`, so surfacing a refusal needs an IPC +
preload + `AxiApi` change.

Now reachable from the UI: `AudioSettings`' `KeyPicker` routes both the
"+ modifier" control and the key grid to `setPttBinding`, so a user can
silently create a collision from Settings.

## 2. `findConflict` / `findActionOwner` ignore modifier asymmetry

Both delegate to `sameBinding`, which compares `a.modifier === b.modifier`.
Plain `F13` versus an action's `ctrl+F13` reports no conflict, yet both fire.
The result is a double-fire — annoying, not destructive.

## 3. `MODE_COPY` typing and error precedence in `HotkeySettings`

`MODE_COPY` is an untyped object literal, and `conflict ?? hotkeys.error` can
hide a persisted rebuild error behind a transient conflict message.

## 4. `KeyPicker`'s warning copy is still PTT-specific

"Heads up: this key triggers PTT while typing anywhere." was correct when the
component was `PttKeyPicker`; it now renders on all four action rows, so
binding Masks to `V` warns about push-to-talk. The warning is still worth
showing — it needs to name the action, or take the text as a prop.

## 5. Portal `bindAll` ignores the shortcuts list the portal returns

`portal-shortcuts.ts` awaits the `BindShortcuts` response and discards it. The
portal may return success having bound only a subset — the compositor can
reject or remap individual triggers. With one spec this was near-tautological;
with up to five, partial success is realistic, and a partial bind that drops
`ptt` yields `ok:true` and therefore an armed, never-unmutable mic. Assert the
response's `shortcuts` array contains `PTT_ID` whenever a PTT spec was sent.

## 6. Stale file headers

- `windows-keys.ts` — "koffi is NOT yet in package.json (Task 2 adds it)"
  refers to an already-shipped feature's task; koffi is a dependency now.
- `evdev-keys.ts` — `createEvdevShortcuts`' docblock still describes the
  deleted single-`bind()` API rather than `bindAll`.

## 7. `AudioSettings`' exclusive-mode select uses `ptt.keyName`

Same coupling class as the display-label bug fixed in `b9c0a80`: `keyName` is
a rendered label, not a key name. Correct today only because exclusive-mode
rebinds always write `modifier: null`.

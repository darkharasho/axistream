# Windows Compatibility — Analysis & Groundwork

**Date:** 2026-07-07 (overnight audit)
**Status:** Groundwork shipped (guards + WindowsObsLauncher + packaging
stanza); full bring-up planned below. NOTHING here has run on a real
Windows machine yet — first Windows boot is the smoke test.

## Shipped groundwork (this branch)

| Change | Why |
|---|---|
| `WindowsObsLauncher` (capture pkg) | win32 previously fell through to FlatpakObsLauncher → 30 s port-wait hang → ERROR. Now: resolve `obs64.exe` (Program Files → x86 → LOCALAPPDATA\Programs, pure + unit-tested), spawn from its own bin dir with `--minimize-to-tray`, `taskkill` for killApp, and a FAST clear error ("install OBS from obsproject.com") when absent. |
| WASAPI audio input kinds | `pulse_*` kinds silently fail on Windows OBS; `ensureAudioInputs` now takes a platform param → `wasapi_output_capture`/`wasapi_input_capture` on win32 (tested). |
| Explicit `/proc` guards on mumbleDeps | Previously only saved by downstream `.catch()`es — now `listPids` returns `[]` off-Linux by construction. |
| Desktop-entry write linux-gated | Stops junk `~/.local/share/applications` trees on Windows. |
| `cageOnPath` PATH delimiter | `;` on win32 (moot today, correct forever). |
| `win:` packaging stanza (nsis) | Present but NOT wired into CI until first smoke. |

Already-safe by construction (verified in the audit): PTT (portal probe →
unavailable), pactl (swallowed), plugin installs (flatpak ENOENT →
'unsupported'), encoder detection (x264 fallback), AppImage updater logic
('skipped'), provisioner (`WINDOWS_KIND = monitor_capture` path already
exists and skips the Wayland approval dance).

## Remaining bring-up (ordered by effort)

1. **First Windows smoke** (needs a Windows machine): boot → OBS launch →
   provision with `monitor_capture` → WASAPI audio → stream. Everything
   below waits on this.
2. **MumbleLink on Windows** (2-3 days): native GW2 uses a named file
   mapping (`OpenFileMapping("MumbleLink")`) — cleaner than the Linux
   /proc trick but needs a tiny native/ffi shim. `MumbleDeps` already
   abstracts it.
3. **PTT on Windows** (3-5 days): Electron `globalShortcut` WORKS on
   Windows (the portal is only needed for Wayland) + a Core-Audio mic-mute
   backend. `PttController`'s injected deps make this a backend swap.
4. **Windows NVENC** (`jim_nvenc` preset + detection) — x264 fallback is
   correct meanwhile.
5. **Game-audio per-app capture**: OBS 31+ has WASAPI application capture
   on Win11 — different plugin story entirely; feature correctly reports
   'unsupported' until then.
6. **Packaging/CI**: windows-latest matrix job, `build/icon.ico`, code
   signing (cert procurement dominates), `latest.yml` feed comes free.

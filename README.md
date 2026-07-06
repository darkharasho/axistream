# axistream

AxiStream is an opinionated, cross-platform (Linux-first; Windows/macOS planned) desktop app that gets a Guild Wars 2 player live on YouTube in about three clicks. It's an Electron front end that drives a hidden OBS Studio over obs-websocket: it captures a game window or display, hardware-encodes (NVENC/VAAPI with automatic x264 fallback) using GW2-tuned bitrate presets, and streams to YouTube over RTMPS — either through a YouTube OAuth connection that creates and manages the broadcast for you (with title templates and a privacy setting), or with a manually pasted stream key as fallback. Differentiation is UX: user-positioned privacy masks drawn on the live preview keep chat/DMs off the stream, audio (desktop + mic) is configured in-app with device pickers, and stream-health chips tell you when the encoder is struggling. GW2 game-state reads (Mumble Link, GW2 API) are out of scope for v1.

## Status

Shipped: capture provisioning (Wayland portal flow), headless OBS lifecycle, YouTube OAuth go-live + title templates, baseline audio with device pickers, privacy masks, encoder presets with hardware detection and software fallback, single-instance lock, Linux packaging (`npm run dist` → AppImage + deb). Remaining for public release: per-app game audio (PipeWire plugin), auto-update, code signing, crash reporting.

## Development

```bash
npm install
npm run dev          # launch the app (spawns a hidden OBS via flatpak)
npm test             # all workspace test suites
npm run dist         # build Linux AppImage + deb into packages/app/dist/
```

Requires the OBS Studio flatpak (`com.obsproject.Studio`) on Linux. YouTube OAuth needs `AXI_YT_CLIENT_ID`/`AXI_YT_CLIENT_SECRET` in a repo-root `.env` (see `docs/superpowers/plans/2026-06-24-youtube-oauth-golive.md` for the one-time Google Cloud setup); without them the app runs in manual-stream-key mode.

Design specs live in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`.

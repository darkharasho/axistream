# axistream

AxiStream is an opinionated Windows and Linux desktop app that gets a Guild Wars 2 player live on YouTube in about three clicks. It's an Electron front end that drives an AxiStream-owned OBS Studio runtime over obs-websocket: it captures a display, hardware-encodes (NVENC on Linux today, with automatic x264 fallback) using GW2-tuned bitrate presets, and streams to YouTube over RTMPS through a YouTube OAuth connection. Differentiation is UX: user-positioned privacy masks drawn on the live preview keep chat/DMs off the stream, audio (desktop + mic) is configured in-app with device pickers, and stream-health chips tell you when the encoder is struggling.

## Status

Shipped: isolated managed OBS runtimes on Windows and Linux, capture provisioning (including Wayland portal flow and Windows monitor selection), YouTube OAuth go-live + title templates, baseline audio with device pickers, privacy masks, a webcam source with corner placement, sizing, and optional mirroring, an encoder picker (vendor + codec) with hardware detection and software fallback — AV1 and HEVC rows are listed but disabled since plain RTMP can't carry them yet, and VAAPI isn't used on Linux because OBS's Simple output mode has no VAAPI mapping — single-instance lock, auto-update, and Linux/Windows packaging. AxiStream never discovers, launches, configures, or stops a user's personal OBS installation.

## Development

```bash
npm install
npm run prepare:obs-runtime -- --platform=linux   # or --platform=windows (add --rebuild to build OBS from source)
npm run dev          # launch the app with the verified owned OBS runtime
npm test             # all workspace test suites
npm run dist         # package the current platform; fails if its runtime is absent
```

Linux runtime preparation downloads the published, hash-pinned `link.axi.AxiStream.OBS` bundle (never the standard OBS Flatpak); `--rebuild` builds it from the pinned recipe instead and needs Flatpak plus `flatpak-builder`. YouTube OAuth needs `AXI_YT_CLIENT_ID`/`AXI_YT_CLIENT_SECRET` in a repo-root `.env` (see `docs/superpowers/plans/2026-06-24-youtube-oauth-golive.md` for the one-time Google Cloud setup).

If an older AxiStream build changed a personal OBS profile, follow [the manual recovery guide](docs/obs-recovery.md). Runtime provenance and redistribution details are in [the OBS redistribution notes](docs/obs-redistribution.md).

Design specs live in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`.

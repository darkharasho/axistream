## Project Context

AxiStream is an opinionated, cross-platform (Linux-first; Windows/macOS planned) desktop app that gets a Guild Wars 2 player live on YouTube in about three clicks. It's an Electron front end that drives a hidden OBS Studio over obs-websocket (`@axistream/capture` owns the OBS-facing code; obs-studio-node was rejected early — no Linux support). It captures a game window/display via the Wayland portal, hardware-encodes (NVENC/VAAPI, automatic x264 fallback) with GW2-tuned bitrate presets, and goes live on YouTube via OAuth + the Live Streaming API (title templates, privacy setting) or a pasted stream key as fallback. Differentiators shipped: user-positioned privacy masks composited in OBS, in-app audio device pickers, truthful stream-health chips. GW2 game-state reads (Mumble Link, GW2 API) are out of scope for v1. Remaining release tail: per-app game audio (needs the PipeWire audio-capture OBS plugin, a flatpak extension), auto-update, code signing, crash reporting.

## Conventions

- Workflow: design spec (`docs/superpowers/specs/`) → implementation plan (`docs/superpowers/plans/`) → feature branch → merge to main with a `Merge feat/x: ...` commit.
- Code style: 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports (ESM/NodeNext). No linter is configured.
- OBS calls are best-effort (`console.warn`, never throw out) — nothing OBS-side may block boot or go-live. OBS stays auth-free on the AxiStream profile (`ensureCleanProfile`).
- Tests: `npm -w @axistream/app run test` and `npm -w @axistream/capture run test` (vitest, fork pool capped at 2). Typecheck gate: `cd packages/app && npx tsc --noEmit -p tsconfig.json`.
- Packaging: `npm run dist` (electron-builder; `electronVersion` is pinned in `packages/app/electron-builder.yml` because workspaces hoist electron — update the pin when bumping electron).

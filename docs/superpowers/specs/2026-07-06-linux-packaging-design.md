# Linux Packaging — Design

**Date:** 2026-07-06
**Status:** Approved (design); pending implementation plan
**Scope:** Installable Linux artifacts (AppImage + deb) for AxiStream via
electron-builder. First slice of the "code signing/notarization,
auto-update, crash reporting" release tail named in the project brief —
this slice is only what's achievable without external infrastructure.

## Problem

AxiStream only runs from `npm run dev`. There is no artifact a GW2 player
can download and run. electron-vite builds `out/{main,preload,renderer}`
but nothing packages it.

## Non-goals (deferred, need infra or other OSes)

Auto-update (needs a publish target + electron-updater — the electron-builder
foundation laid here is what it plugs into later); code signing (certs);
crash reporting (service choice); Windows/macOS targets (need those
build hosts); bundling OBS itself (v1 depends on the user's flatpak OBS —
unchanged).

## Key facts that shape the design

- `electron.vite.config.ts` does NOT use `externalizeDepsPlugin` — rollup
  bundles every dependency (all pure JS) into `out/`, with only ws's
  optional native addons (`bufferutil`, `utf-8-validate`) external and
  try/caught at runtime. **The packaged app therefore needs no production
  `node_modules` at all.**
- `packages/app/package.json` lists `@axistream/capture: "*"` (a workspace
  ref) under `dependencies` — electron-builder would try to pack/rebuild
  node_modules for it and choke on the workspace protocol. Since everything
  is bundled, those deps belong in `devDependencies`.
- `packages/app/build/icon.png` exists (used for the window/tray icon).

## Approaches considered

1. **electron-builder (chosen).** Standard for electron-vite projects;
   AppImage + deb from one config; `electron-updater` slots in later for
   auto-update. Config-only integration given the bundle-everything build.
2. **electron-forge.** Equivalent capability but a different plugin
   ecosystem; electron-vite's docs and templates pair with
   electron-builder. No advantage here.
3. **Manual zip of out/ + electron binaries.** No installer UX, no desktop
   integration, dead end for auto-update. Rejected.

## Design

All changes inside `packages/app` (plus a root convenience script).

### package.json changes

- `version`: `0.0.0` → `0.1.0` (first packaged build).
- Move `@axistream/capture`, `@fontsource/cinzel`, `@fontsource/inter`,
  `lucide-react` from `dependencies` to `devDependencies` (they are
  compile-time inputs to the vite bundle; nothing requires them at
  runtime). `dependencies` ends up absent/empty.
- Add devDependency `electron-builder@^24` (one new dev-only dependency —
  the point of the feature).
- Scripts: `"dist": "electron-vite build && electron-builder --config electron-builder.yml"`;
  root package.json gains `"dist": "npm -w @axistream/app run dist"`.

### electron-builder.yml (new, in packages/app)

```yaml
appId: link.axi.axistream
productName: AxiStream
directories:
  output: dist
  buildResources: build
files:
  - out/**
asar: true
npmRebuild: false            # bundle has no native deps; skip node_modules entirely
electronLanguages: [en-US]
linux:
  target: [AppImage, deb]
  category: AudioVideo
  icon: build/icon.png
  synopsis: Get live on YouTube in three clicks
  maintainer: AxiStream <project96@gmail.com>
```

`npmRebuild: false` + no prod deps = electron-builder packs `out/**` and
`package.json` into the asar and marries it to the Electron 31 runtime.
Note: with `files: [out/**]` electron-builder always includes
`package.json` implicitly; `main: out/main/index.js` already points inside
the packaged tree, unchanged.

### .gitignore

`packages/app/dist/` added (artifacts are large and machine-built).

### Verification

`scripts` don't lie, builds do: run `npm -w @axistream/app run dist` and
assert `packages/app/dist/AxiStream-0.1.0.AppImage` (electron-builder's
default artifact name pattern; accept any `*.AppImage`) and a `*.deb`
exist; `npx asar list dist/linux-unpacked/resources/app.asar | grep out/main/index.js`
confirms the bundle is inside. Launch smoke (AppImage opens, OBS boots,
preview shows) is a human step — it spawns windows and OBS.

## Error handling

Build-time only; no runtime code changes. If the icon is smaller than
electron-builder's 512×512 preference it warns and continues — acceptable
for 0.1.0 (note in the plan to check the warning).

## Testing

- Existing suites must stay green (dep reshuffle can't break them: vitest
  resolves via the workspace root node_modules either way) — full app +
  capture suites + tsc as the gate.
- Artifact assertions above (real `dist` run).
- No new unit tests — there is no new runtime code.

# Linux Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dist` produces installable Linux artifacts (AppImage + deb) for AxiStream.

**Architecture:** electron-builder over the existing electron-vite bundle-everything build — no production node_modules in the artifact (`npmRebuild: false`, deps moved to devDependencies), config-only integration. Spec: `docs/superpowers/specs/2026-07-06-linux-packaging-design.md`.

**Tech Stack:** electron-builder ^24 (new devDependency — the point of the feature), electron-vite 2, Electron 31.

## Global Constraints

- Exactly ONE new dependency: `electron-builder@^24` in `packages/app` devDependencies. Nothing else.
- No runtime code changes — config, manifests, and scripts only.
- Exact values: appId `link.axi.axistream`, productName `AxiStream`, version `0.1.0`, targets `[AppImage, deb]`, category `AudioVideo`, `asar: true`, `npmRebuild: false`, output dir `dist`, maintainer `AxiStream <project96@gmail.com>`.
- Gates: full app + capture suites stay green; `tsc --noEmit` zero errors; a real `dist` run produces both artifacts and the asar contains `out/main/index.js`.

---

### Task 1: Manifests, config, scripts

**Files:**
- Modify: `packages/app/package.json`, `package.json` (root), `.gitignore` (root)
- Create: `packages/app/electron-builder.yml`

- [ ] **Step 1:** In `packages/app/package.json`: set `"version": "0.1.0"`; delete the `dependencies` block entirely and move its four entries (`@axistream/capture": "*"`, `@fontsource/cinzel`, `@fontsource/inter`, `lucide-react` — keep their existing version ranges) into `devDependencies` (sorted); add `"dist": "electron-vite build && electron-builder --config electron-builder.yml"` to scripts.
- [ ] **Step 2:** Install the builder: `npm install -D electron-builder@^24 -w @axistream/app` (this also reshuffles the lockfile for the dep moves).
- [ ] **Step 3:** Create `packages/app/electron-builder.yml`:

```yaml
appId: link.axi.axistream
productName: AxiStream
directories:
  output: dist
  buildResources: build
files:
  - out/**
asar: true
npmRebuild: false            # everything is bundled by electron-vite; no native deps
electronLanguages: [en-US]
linux:
  target: [AppImage, deb]
  category: AudioVideo
  icon: build/icon.png
  synopsis: Get live on YouTube in three clicks
  maintainer: AxiStream <project96@gmail.com>
```

- [ ] **Step 4:** Root `package.json` scripts: add `"dist": "npm -w @axistream/app run dist"`. Root `.gitignore`: add `packages/app/dist/` (check the file exists first; create if the repo instead ignores via another file, match its conventions).
- [ ] **Step 5:** Regression gates: `npm -w @axistream/app run test` (all pass — the dep moves must not break module resolution; vitest resolves through the hoisted root node_modules either way), `npm -w @axistream/capture run test`, `cd packages/app && npx tsc --noEmit -p tsconfig.json` (zero errors).
- [ ] **Step 6:** Commit:

```bash
git add packages/app/package.json packages/app/electron-builder.yml package.json package-lock.json .gitignore
git commit -m "build: electron-builder config for Linux AppImage/deb"
```

---

### Task 2: Real build verification

**Files:** none (build run + assertions)

- [ ] **Step 1:** `npm -w @axistream/app run dist` (expect several minutes on first run: downloads the Electron 31 dist zip and AppImage tooling). Watch for the icon-size warning (icon < 512×512 is acceptable for 0.1.0 — record it if it appears).
- [ ] **Step 2:** Assert artifacts:

```bash
ls packages/app/dist/*.AppImage packages/app/dist/*.deb
npx asar list packages/app/dist/linux-unpacked/resources/app.asar | grep -c 'out/main/index.js'   # expect 1
```

- [ ] **Step 3:** Confirm the packaged `package.json` has no `dependencies` (asar extract-file):

```bash
npx asar extract-file packages/app/dist/linux-unpacked/resources/app.asar package.json && grep -c '"dependencies"' package.json || echo NONE; rm -f package.json
```

(Run from a scratch directory, NOT the repo root — the extract writes `./package.json`.)

- [ ] **Step 4:** If the build fails: common causes are (a) leftover `dependencies` entries → recheck Task 1 Step 1; (b) electron download blocked → retry, or set `ELECTRON_MIRROR`; (c) missing `main` → confirm `out/main/index.js` exists after `electron-vite build`. Fix within this task and note in the ledger.
- [ ] **Step 5:** Nothing new to commit if clean (dist/ is git-ignored). Note artifact names + sizes in the ledger. Human launch smoke (AppImage opens, OBS boots) stays on the checklist.

---

## Final verification (whole branch)

Both suites green, tsc zero, both artifacts present, asar contains the main bundle, packaged package.json has no `dependencies`.

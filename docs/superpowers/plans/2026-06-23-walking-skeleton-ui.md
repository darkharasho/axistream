# Walking-Skeleton UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AxiStream Electron app shell + the core "launch → capture setup → paste key → Go Live → live status" flow on top of the `@axistream/capture` library.

**Architecture:** npm workspaces (`packages/capture` = the existing library, `packages/app` = electron-vite app). The app's **main** process owns the library and orchestration services (`CaptureService`, `StreamController`, `KeyStore`, `PreviewPump`) and talks to the **renderer** (React+TS) over a typed `contextBridge` preload: commands via `invoke`/`handle`, state/stats/preview pushed as events. The renderer is a thin reactive view driven by a `StreamPhase` state machine.

**Tech Stack:** Node 24, TypeScript, electron-vite, Electron, React 18, Vitest, @testing-library/react, Playwright (electron), `@axistream/capture`.

## Global Constraints

- **Workspaces:** `packages/capture` (moved library) + `packages/app`. The library keeps its own 22-test suite and is consumed as `@axistream/capture`.
- **Test runner:** Vitest with the **forks pool, 2 workers max** (`pool: 'forks', poolOptions: { forks: { minForks: 1, maxForks: 2 } }`). Never pass `--maxWorkers=2` on the CLI. Invoke as `npx vitest run <path>`.
- **ESM + `.js` import extensions** in TypeScript source (matches the capture library).
- **Security:** renderer windows use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (preload needs Node for `contextBridge` only). Renderer touches only `window.axi`.
- **Visual direction:** dark theme, cyan accent `#22d3ee`, monospace for stats; labeled sidebar shell + cinematic preview-forward Stream screen; frameless window with custom title bar.
- **Stream phases (exact):** `SETTING_UP | AWAITING_APPROVAL | NEEDS_KEY | READY | GOING_LIVE | LIVE | RECONNECTING | ERROR`.
- **YouTube ingest:** `rtmps://a.rtmps.youtube.com/live2` (matches the capture library's proven path).
- **Key storage:** Electron `safeStorage`, with a graceful fallback when encryption is unavailable.

---

## File Structure

**Workspace root:** `package.json` (workspaces), keep root `.gitignore`.

**`packages/capture/`** — the existing library, moved verbatim (`src/`, `test/`, `package.json` renamed to `@axistream/capture`, `tsconfig.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `scripts/`).

**`packages/app/`:**
- `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `index.html`
- `src/shared/state.ts` — shared types (`StreamPhase`, `AppState`, `LiveStats`, `CaptureMeta`, `INITIAL_STATE`) + IPC channel constants + the `AxiApi` interface.
- `src/main/index.ts` — app entry, window lifecycle, boot orchestration, quit-while-live guard.
- `src/main/CaptureService.ts` — wraps `ObsSidecar` + `Provisioner`.
- `src/main/StreamController.ts` — go-live/stop + `GetStreamStatus` polling.
- `src/main/KeyStore.ts` — safeStorage key persistence.
- `src/main/PreviewPump.ts` — periodic screenshot frames.
- `src/main/ipc.ts` — wires commands + events to a `BrowserWindow`.
- `src/preload/index.ts` — `contextBridge` exposing `window.axi`.
- `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/store.ts`
- `src/renderer/components/Sidebar.tsx`, `StreamScreen.tsx`, `SettingsScreen.tsx`, `KeyInput.tsx`, `StatChips.tsx`
- `src/renderer/styles.css`
- `test/**` (unit) and `test/e2e/**` (Playwright-electron).

---

### Task 1: Workspace restructure + electron-vite app scaffold

**Files:**
- Create: root `package.json` (workspaces)
- Move: library → `packages/capture/` (git mv)
- Create: `packages/app/package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`

**Interfaces:**
- Produces: a booting Electron app (`npm -w @axistream/app run dev`) showing a blank dark window titled "AxiStream"; `@axistream/capture` resolves from `packages/capture`; the capture suite still passes from its new location.

- [ ] **Step 1: Move the library into `packages/capture`**

```bash
mkdir -p packages/capture
git mv src test scripts package.json tsconfig.json vitest.config.ts vitest.integration.config.ts package-lock.json packages/capture/ 2>/dev/null || true
# package-lock may not move cleanly; if it errors, leave it and regenerate at root later
```
Then set the library package name. Edit `packages/capture/package.json` `"name"` to `"@axistream/capture"` and add `"exports": { ".": "./src/index.ts" }`.

- [ ] **Step 2: Verify the library still tests from its new home**

Run: `cd packages/capture && npx vitest run`
Expected: 22 passed.

- [ ] **Step 3: Create the workspace root `package.json`**

```json
{
  "name": "axistream",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "npm -ws --if-present run test",
    "dev": "npm -w @axistream/app run dev",
    "build": "npm -ws --if-present run build"
  }
}
```

- [ ] **Step 4: Create `packages/app/package.json`**

```json
{
  "name": "@axistream/app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run"
  },
  "dependencies": { "@axistream/capture": "*" },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "vite": "^5.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "jsdom": "^24.1.0"
  }
}
```

- [ ] **Step 5: Create `packages/app/electron.vite.config.ts`**

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } } },
  renderer: {
    root: resolve(__dirname),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'index.html') } },
  },
})
```

- [ ] **Step 6: Create `packages/app/tsconfig.json` and `tsconfig.node.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "test"]
}
```
`tsconfig.node.json`:
```json
{ "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "Bundler" }, "include": ["electron.vite.config.ts"] }
```

- [ ] **Step 7: Create `index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8" /><title>AxiStream</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" />
</head><body><div id="root"></div><script type="module" src="/src/renderer/main.tsx"></script></body></html>
```

- [ ] **Step 8: Create minimal `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960, height: 620, frame: false, backgroundColor: '#0b0d12', show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 9: Create minimal `src/preload/index.ts`**

```ts
import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('axi', { ping: () => 'pong' })
```

- [ ] **Step 10: Create renderer `src/renderer/main.tsx`, `App.tsx`, `styles.css`**

`main.tsx`:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
```
`App.tsx`:
```tsx
export function App() {
  return <div className="app"><div className="titlebar">AxiStream</div><div className="placeholder">loading…</div></div>
}
```
`styles.css`:
```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0b0d12; color: #e6edf3; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
.app { height: 100vh; display: flex; flex-direction: column; }
.titlebar { height: 40px; display: flex; align-items: center; padding: 0 14px; font-weight: 700; border-bottom: 1px solid #161c25; -webkit-app-region: drag; }
.placeholder { flex: 1; display: grid; place-items: center; color: #768390; }
```

- [ ] **Step 11: Install and boot**

```bash
npm install
npm -w @axistream/app run dev
```
Expected: a frameless dark window titled "AxiStream" appears showing "loading…". Close it.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: npm workspaces + electron-vite app scaffold"
```

---

### Task 2: Shared state types + renderer store

**Files:**
- Create: `packages/app/src/shared/state.ts`
- Create: `packages/app/src/renderer/store.ts`
- Create: `packages/app/vitest.config.ts`
- Test: `packages/app/test/store.test.ts`

**Interfaces:**
- Produces:
  - `type StreamPhase` (the 8 exact phases)
  - `interface CaptureMeta { sourceLabel: string; width: number; height: number; fps: number }`
  - `interface LiveStats { bitrateKbps: number; droppedFrames: number; durationMs: number; encoder: string; cpuPct: number; reconnecting: boolean }`
  - `interface AppState { phase: StreamPhase; capture: CaptureMeta | null; keyMasked: string | null; stats: LiveStats | null; error: string | null }`
  - `const INITIAL_STATE: AppState`
  - `const CH` channel-name constants: `{ getInitialState, provision, saveKey, forgetKey, goLive, stopStream, repairCapture, evtState, evtStats, evtPreview }`
  - `interface AxiApi` (the `window.axi` shape)
  - Store: `createStore()` returning `{ getState, subscribe, applyState(partial), applyStats(s), applyPreview(url), getPreview() }`

- [ ] **Step 1: Create `packages/app/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['test/e2e/**', 'node_modules/**'],
    setupFiles: ['./test/setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
  },
})
```
And `packages/app/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 2: Write the failing test `test/store.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createStore } from '../src/renderer/store.js'
import { INITIAL_STATE } from '../src/shared/state.js'

describe('store', () => {
  it('starts at INITIAL_STATE', () => {
    expect(createStore().getState()).toEqual(INITIAL_STATE)
  })
  it('applyState merges a partial and notifies subscribers', () => {
    const s = createStore()
    const sub = vi.fn()
    s.subscribe(sub)
    s.applyState({ phase: 'READY', keyMasked: '····7f3a' })
    expect(s.getState().phase).toBe('READY')
    expect(s.getState().keyMasked).toBe('····7f3a')
    expect(sub).toHaveBeenCalledOnce()
  })
  it('applyStats updates stats slice', () => {
    const s = createStore()
    s.applyStats({ bitrateKbps: 6000, droppedFrames: 0, durationMs: 1000, encoder: 'x264', cpuPct: 10, reconnecting: false })
    expect(s.getState().stats?.bitrateKbps).toBe(6000)
  })
  it('applyPreview stores the latest frame without touching AppState', () => {
    const s = createStore()
    s.applyPreview('data:image/png;base64,AAAA')
    expect(s.getPreview()).toBe('data:image/png;base64,AAAA')
    expect(s.getState().phase).toBe('SETTING_UP')
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd packages/app && npx vitest run test/store.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/store.js`.

- [ ] **Step 4: Implement `src/shared/state.ts`**

```ts
export type StreamPhase =
  | 'SETTING_UP' | 'AWAITING_APPROVAL' | 'NEEDS_KEY' | 'READY'
  | 'GOING_LIVE' | 'LIVE' | 'RECONNECTING' | 'ERROR'

export interface CaptureMeta { sourceLabel: string; width: number; height: number; fps: number }
export interface LiveStats {
  bitrateKbps: number; droppedFrames: number; durationMs: number;
  encoder: string; cpuPct: number; reconnecting: boolean
}
export interface AppState {
  phase: StreamPhase
  capture: CaptureMeta | null
  keyMasked: string | null
  stats: LiveStats | null
  error: string | null
}
export const INITIAL_STATE: AppState = {
  phase: 'SETTING_UP', capture: null, keyMasked: null, stats: null, error: null,
}

export const CH = {
  getInitialState: 'axi:getInitialState',
  provision: 'axi:provision',
  saveKey: 'axi:saveKey',
  forgetKey: 'axi:forgetKey',
  goLive: 'axi:goLive',
  stopStream: 'axi:stopStream',
  repairCapture: 'axi:repairCapture',
  evtState: 'axi:evt:state',
  evtStats: 'axi:evt:stats',
  evtPreview: 'axi:evt:preview',
} as const

export interface AxiApi {
  getInitialState(): Promise<AppState>
  provision(): Promise<void>
  saveKey(key: string): Promise<void>
  forgetKey(): Promise<void>
  goLive(): Promise<void>
  stopStream(): Promise<void>
  repairCapture(): Promise<void>
  onState(cb: (s: Partial<AppState>) => void): () => void
  onStats(cb: (s: LiveStats) => void): () => void
  onPreview(cb: (dataUrl: string) => void): () => void
}
```

- [ ] **Step 5: Implement `src/renderer/store.ts`**

```ts
import { AppState, LiveStats, INITIAL_STATE } from '../shared/state.js'

export function createStore() {
  let state: AppState = { ...INITIAL_STATE }
  let preview: string | null = null
  const subs = new Set<() => void>()
  const notify = () => subs.forEach((f) => f())
  return {
    getState: () => state,
    getPreview: () => preview,
    subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn) },
    applyState(partial: Partial<AppState>) { state = { ...state, ...partial }; notify() },
    applyStats(s: LiveStats) { state = { ...state, stats: s }; notify() },
    applyPreview(dataUrl: string) { preview = dataUrl; notify() },
  }
}
export type Store = ReturnType<typeof createStore>
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd packages/app && npx vitest run test/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/renderer/store.ts packages/app/vitest.config.ts packages/app/test/setup.ts packages/app/test/store.test.ts
git commit -m "feat: shared state types + renderer store"
```

---

### Task 3: KeyStore (safeStorage persistence)

**Files:**
- Create: `packages/app/src/main/KeyStore.ts`
- Test: `packages/app/test/key-store.test.ts`

**Interfaces:**
- Consumes: Electron `safeStorage` (injected for tests).
- Produces:
  - `interface SafeStorageLike { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }`
  - `class KeyStore { constructor(filePath: string, safe: SafeStorageLike); save(key: string): void; load(): string | null; forget(): void; masked(): string | null; canPersist(): boolean }`
  - `masked()` returns `"····" + last4` or null.

- [ ] **Step 1: Write the failing test `test/key-store.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KeyStore, type SafeStorageLike } from '../src/main/KeyStore.js'

// Fake safeStorage that XORs — enough to prove encrypt/decrypt round-trips and
// that the plaintext key is not written to disk verbatim.
function fakeSafe(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
    decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
  }
}

describe('KeyStore', () => {
  let dir: string, file: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aks-')); file = join(dir, 'key.bin') })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('round-trips a key and masks it', () => {
    const ks = new KeyStore(file, fakeSafe())
    ks.save('xxxx-yyyy-zzzz-7f3a')
    expect(ks.load()).toBe('xxxx-yyyy-zzzz-7f3a')
    expect(ks.masked()).toBe('····7f3a')
  })
  it('does not write the plaintext key to disk', () => {
    const ks = new KeyStore(file, fakeSafe())
    ks.save('SECRET-KEY-7f3a')
    const raw = require('node:fs').readFileSync(file)
    expect(raw.toString()).not.toContain('SECRET-KEY')
  })
  it('forget() removes the stored key', () => {
    const ks = new KeyStore(file, fakeSafe())
    ks.save('abcd-7f3a'); ks.forget()
    expect(ks.load()).toBeNull()
    expect(existsSync(file)).toBe(false)
  })
  it('canPersist() is false and save is a no-op when encryption is unavailable', () => {
    const ks = new KeyStore(file, fakeSafe(false))
    expect(ks.canPersist()).toBe(false)
    ks.save('abcd-7f3a')
    expect(existsSync(file)).toBe(false)
    expect(ks.load()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run test/key-store.test.ts`
Expected: FAIL — cannot resolve `../src/main/KeyStore.js`.

- [ ] **Step 3: Implement `src/main/KeyStore.ts`**

```ts
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export class KeyStore {
  constructor(private readonly filePath: string, private readonly safe: SafeStorageLike) {}

  canPersist(): boolean { return this.safe.isEncryptionAvailable() }

  save(key: string): void {
    if (!this.canPersist()) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, this.safe.encryptString(key))
  }

  load(): string | null {
    if (!existsSync(this.filePath) || !this.canPersist()) return null
    try { return this.safe.decryptString(readFileSync(this.filePath)) } catch { return null }
  }

  forget(): void { try { rmSync(this.filePath, { force: true }) } catch { /* ignore */ } }

  masked(): string | null {
    const k = this.load()
    return k ? '····' + k.slice(-4) : null
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run test/key-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/KeyStore.ts packages/app/test/key-store.test.ts
git commit -m "feat: KeyStore safeStorage persistence + masking + fallback"
```

---

### Task 4: StreamController (go-live / stop / live stats)

**Files:**
- Create: `packages/app/src/main/StreamController.ts`
- Test: `packages/app/test/stream-controller.test.ts`

**Interfaces:**
- Consumes: a sidecar client `{ call(req, data?): Promise<any> }` (injected); `callReady` from `@axistream/capture`.
- Produces:
  - `interface StreamDeps { client(): { call(req: string, data?: any): Promise<any> }; onStats(s: LiveStats): void; onPhase(p: 'GOING_LIVE'|'LIVE'|'RECONNECTING'|'READY'|'ERROR', error?: string): void; pollMs?: number; goLiveTimeoutMs?: number }`
  - `class StreamController { constructor(d: StreamDeps); goLive(key: string): Promise<void>; stop(): Promise<void>; isLive(): boolean }`
  - `goLive`: set `rtmp_custom` service to YouTube RTMPS + key, `StartStream`, emit `GOING_LIVE`; poll `GetStreamStatus` every `pollMs` (default 1000); on `outputActive` emit `LIVE` + `onStats` each poll; if not active within `goLiveTimeoutMs` (default 15000) → `StopStream` + emit `ERROR`. `outputReconnecting` → `RECONNECTING`.
  - `stop`: `StopStream`, stop polling, emit `READY`.
  - Stats mapping: `GetStreamStatus` → `LiveStats` (bitrate from bytes delta / interval; dropped from `outputSkippedFrames`; durationMs from `outputDuration`; encoder fixed `'x264'` for v1; cpuPct from `outputCongestion`*100 if present else 0; reconnecting from `outputReconnecting`).

- [ ] **Step 1: Write the failing test `test/stream-controller.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { StreamController } from '../src/main/StreamController.js'

function clientFrom(statuses: any[]) {
  let i = 0
  const calls: string[] = []
  return {
    calls,
    client: () => ({
      call: vi.fn(async (req: string) => {
        calls.push(req)
        if (req === 'GetStreamStatus') return statuses[Math.min(i++, statuses.length - 1)]
        return {}
      }),
    }),
  }
}

describe('StreamController', () => {
  it('goLive sets service, starts, reaches LIVE, emits stats', async () => {
    const c = clientFrom([
      { outputActive: true, outputReconnecting: false, outputDuration: 1000, outputBytes: 100000, outputSkippedFrames: 0, outputTotalFrames: 60 },
    ])
    const phases: string[] = []
    const stats: any[] = []
    const sc = new StreamController({
      client: c.client, onPhase: (p) => phases.push(p), onStats: (s) => stats.push(s),
      pollMs: 5, goLiveTimeoutMs: 500,
    })
    await sc.goLive('key-7f3a')
    await new Promise((r) => setTimeout(r, 30))
    await sc.stop()
    expect(c.calls).toContain('SetStreamServiceSettings')
    expect(c.calls).toContain('StartStream')
    expect(phases).toContain('GOING_LIVE')
    expect(phases).toContain('LIVE')
    expect(stats[0].bitrateKbps).toBeGreaterThanOrEqual(0)
    expect(sc.isLive()).toBe(false) // stopped
  })

  it('emits ERROR and stops if the stream never goes active before timeout', async () => {
    const c = clientFrom([{ outputActive: false, outputReconnecting: false, outputBytes: 0 }])
    const phases: string[] = []
    const sc = new StreamController({ client: c.client, onPhase: (p) => phases.push(p), onStats: () => {}, pollMs: 5, goLiveTimeoutMs: 40 })
    await sc.goLive('key')
    await new Promise((r) => setTimeout(r, 90))
    expect(phases).toContain('ERROR')
    expect(c.calls).toContain('StopStream')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run test/stream-controller.test.ts`
Expected: FAIL — cannot resolve `../src/main/StreamController.js`.

- [ ] **Step 3: Implement `src/main/StreamController.ts`**

```ts
import { callReady } from '@axistream/capture'
import type { LiveStats } from '../shared/state.js'

const YT_RTMPS = 'rtmps://a.rtmps.youtube.com/live2'

type Phase = 'GOING_LIVE' | 'LIVE' | 'RECONNECTING' | 'READY' | 'ERROR'
export interface StreamDeps {
  client(): { call(req: string, data?: any): Promise<any> }
  onStats(s: LiveStats): void
  onPhase(p: Phase, error?: string): void
  pollMs?: number
  goLiveTimeoutMs?: number
}

export class StreamController {
  private timer: ReturnType<typeof setInterval> | null = null
  private live = false
  private lastBytes = 0
  private startedAt = 0
  constructor(private readonly d: StreamDeps) {}

  isLive(): boolean { return this.live }

  async goLive(key: string): Promise<void> {
    const c = this.d.client()
    await callReady(() => c.call('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: YT_RTMPS, key },
    }))
    await callReady(() => c.call('StartStream'))
    this.d.onPhase('GOING_LIVE')
    this.lastBytes = 0
    this.startedAt = 0
    const pollMs = this.d.pollMs ?? 1000
    const deadline = (this.d.goLiveTimeoutMs ?? 15000) / pollMs
    let ticks = 0
    let becameLive = false
    this.timer = setInterval(async () => {
      ticks++
      let st: any
      try { st = await c.call('GetStreamStatus') } catch { return }
      if (!st.outputActive && !becameLive) {
        if (ticks >= deadline) { await this.failStart(c) }
        return
      }
      if (st.outputActive && !becameLive) { becameLive = true; this.live = true; this.d.onPhase('LIVE') }
      this.d.onPhase(st.outputReconnecting ? 'RECONNECTING' : 'LIVE')
      this.d.onStats(this.mapStats(st, pollMs))
    }, pollMs)
  }

  private async failStart(c: { call(r: string): Promise<any> }): Promise<void> {
    this.clear()
    try { await c.call('StopStream') } catch { /* ignore */ }
    this.live = false
    this.d.onPhase('ERROR', "Couldn't start stream — check your key and connection.")
  }

  private mapStats(st: any, pollMs: number): LiveStats {
    const bytes = Number(st.outputBytes ?? 0)
    const delta = Math.max(0, bytes - this.lastBytes)
    this.lastBytes = bytes
    const bitrateKbps = Math.round((delta * 8) / 1000 / (pollMs / 1000))
    return {
      bitrateKbps,
      droppedFrames: Number(st.outputSkippedFrames ?? 0),
      durationMs: Number(st.outputDuration ?? 0),
      encoder: 'x264',
      cpuPct: Math.round(Number(st.outputCongestion ?? 0) * 100),
      reconnecting: !!st.outputReconnecting,
    }
  }

  async stop(): Promise<void> {
    this.clear()
    try { await this.d.client().call('StopStream') } catch { /* ignore */ }
    this.live = false
    this.d.onPhase('READY')
  }

  private clear(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run test/stream-controller.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamController.ts packages/app/test/stream-controller.test.ts
git commit -m "feat: StreamController go-live/stop + GetStreamStatus polling"
```

---

### Task 5: CaptureService + PreviewPump

**Files:**
- Create: `packages/app/src/main/CaptureService.ts`, `packages/app/src/main/PreviewPump.ts`
- Test: `packages/app/test/capture-service.test.ts`, `packages/app/test/preview-pump.test.ts`

**Interfaces:**
- Consumes: `@axistream/capture` (`ObsSidecar`, `Provisioner`, `CaptureConfig`); injected for tests.
- Produces:
  - `interface CaptureServiceDeps { sidecar: { start(): Promise<void>; client(): any; restart(): Promise<void>; stop(): Promise<void>; on(e: 'crashed', cb: () => void): void }; makeProvisioner(): { status(): string; provision(cb?: () => void): Promise<{ ok: boolean; status: string }> }; onApprovalNeeded(): void; onPhase(p: 'READY'|'AWAITING_APPROVAL'|'SETTING_UP'|'ERROR', error?: string): void; onCrashed(): void }`
  - `class CaptureService { constructor(d); start(): Promise<void>; provision(): Promise<boolean>; status(): string }`
  - `interface PreviewPumpDeps { client(): { call(req: string, data?: any): Promise<any> }; sourceName: string; emit(dataUrl: string): void; intervalMs?: number }`
  - `class PreviewPump { constructor(d); start(): void; stop(): void; setVisible(v: boolean): void }`

- [ ] **Step 1: Write the failing test `test/preview-pump.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { PreviewPump } from '../src/main/PreviewPump.js'

describe('PreviewPump', () => {
  it('emits frames on an interval and stops cleanly', async () => {
    const client = { call: vi.fn(async () => ({ imageData: 'data:image/png;base64,AAAA' })) }
    const frames: string[] = []
    const pump = new PreviewPump({ client: () => client, sourceName: 'AxiStream Capture', emit: (d) => frames.push(d), intervalMs: 5 })
    pump.start()
    await new Promise((r) => setTimeout(r, 24))
    pump.stop()
    const n = frames.length
    expect(n).toBeGreaterThanOrEqual(2)
    await new Promise((r) => setTimeout(r, 15))
    expect(frames.length).toBe(n) // no frames after stop
  })

  it('does not emit while hidden', async () => {
    const client = { call: vi.fn(async () => ({ imageData: 'data:image/png;base64,AAAA' })) }
    const frames: string[] = []
    const pump = new PreviewPump({ client: () => client, sourceName: 'AxiStream Capture', emit: (d) => frames.push(d), intervalMs: 5 })
    pump.start(); pump.setVisible(false)
    await new Promise((r) => setTimeout(r, 24))
    expect(frames.length).toBe(0)
    pump.stop()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run test/preview-pump.test.ts`
Expected: FAIL — cannot resolve `../src/main/PreviewPump.js`.

- [ ] **Step 3: Implement `src/main/PreviewPump.ts`**

```ts
export interface PreviewPumpDeps {
  client(): { call(req: string, data?: any): Promise<any> }
  sourceName: string
  emit(dataUrl: string): void
  intervalMs?: number
}

export class PreviewPump {
  private timer: ReturnType<typeof setInterval> | null = null
  private visible = true
  private inFlight = false
  constructor(private readonly d: PreviewPumpDeps) {}

  setVisible(v: boolean): void { this.visible = v }

  start(): void {
    if (this.timer) return
    const ms = this.d.intervalMs ?? 700
    this.timer = setInterval(() => { void this.tick() }, ms)
  }

  private async tick(): Promise<void> {
    if (!this.visible || this.inFlight) return
    this.inFlight = true
    try {
      const shot = await this.d.client().call('GetSourceScreenshot', {
        sourceName: this.d.sourceName, imageFormat: 'png', imageWidth: 480,
      })
      if (shot?.imageData) this.d.emit(shot.imageData)
    } catch { /* skip this frame */ } finally { this.inFlight = false }
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/app && npx vitest run test/preview-pump.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test `test/capture-service.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { CaptureService } from '../src/main/CaptureService.js'

function deps(provisionResult = { ok: true, status: 'READY' }) {
  const sidecar = {
    start: vi.fn().mockResolvedValue(undefined),
    client: vi.fn(() => ({ call: vi.fn() })),
    restart: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }
  const provisioner = { status: vi.fn(() => 'UNPROVISIONED'), provision: vi.fn(async (cb?: () => void) => { cb?.(); return provisionResult }) }
  const phases: any[] = []
  const svc = new CaptureService({
    sidecar: sidecar as any,
    makeProvisioner: () => provisioner as any,
    onApprovalNeeded: () => phases.push('AWAITING_APPROVAL'),
    onPhase: (p) => phases.push(p),
    onCrashed: () => phases.push('CRASHED'),
  })
  return { svc, sidecar, provisioner, phases }
}

describe('CaptureService', () => {
  it('start() boots the sidecar and registers a crash handler', async () => {
    const { svc, sidecar } = deps()
    await svc.start()
    expect(sidecar.start).toHaveBeenCalledOnce()
    expect(sidecar.on).toHaveBeenCalledWith('crashed', expect.any(Function))
  })
  it('provision() fires approval-needed then READY on success', async () => {
    const { svc, phases } = deps({ ok: true, status: 'READY' })
    await svc.start()
    const ok = await svc.provision()
    expect(ok).toBe(true)
    expect(phases).toContain('AWAITING_APPROVAL')
    expect(phases).toContain('READY')
  })
  it('provision() emits SETTING_UP again on failure', async () => {
    const { svc, phases } = deps({ ok: false, status: 'AWAITING_APPROVAL' })
    await svc.start()
    const ok = await svc.provision()
    expect(ok).toBe(false)
    expect(phases).toContain('SETTING_UP')
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd packages/app && npx vitest run test/capture-service.test.ts`
Expected: FAIL — cannot resolve `../src/main/CaptureService.js`.

- [ ] **Step 7: Implement `src/main/CaptureService.ts`**

```ts
type Phase = 'READY' | 'AWAITING_APPROVAL' | 'SETTING_UP' | 'ERROR'
export interface CaptureServiceDeps {
  sidecar: {
    start(): Promise<void>; client(): any; restart(): Promise<void>; stop(): Promise<void>
    on(e: 'crashed', cb: () => void): void
  }
  makeProvisioner(): { status(): string; provision(cb?: () => void): Promise<{ ok: boolean; status: string }> }
  onApprovalNeeded(): void
  onPhase(p: Phase, error?: string): void
  onCrashed(): void
}

export class CaptureService {
  private provisioner!: ReturnType<CaptureServiceDeps['makeProvisioner']>
  constructor(private readonly d: CaptureServiceDeps) {}

  client() { return this.d.sidecar.client() }

  async start(): Promise<void> {
    await this.d.sidecar.start()
    this.provisioner = this.d.makeProvisioner()
    this.d.sidecar.on('crashed', () => this.d.onCrashed())
  }

  status(): string { return this.provisioner.status() }

  async provision(): Promise<boolean> {
    const res = await this.provisioner.provision(() => this.d.onApprovalNeeded())
    if (res.ok) { this.d.onPhase('READY'); return true }
    this.d.onPhase('SETTING_UP')
    return false
  }
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd packages/app && npx vitest run test/capture-service.test.ts test/preview-pump.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/main/CaptureService.ts packages/app/src/main/PreviewPump.ts packages/app/test/capture-service.test.ts packages/app/test/preview-pump.test.ts
git commit -m "feat: CaptureService + PreviewPump"
```

---

### Task 6: IPC layer + preload bridge + contract test

**Files:**
- Create: `packages/app/src/main/ipc.ts`
- Rewrite: `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `CH`/`AxiApi` from `src/shared/state.ts`.
- Produces:
  - `function registerIpc(deps: IpcDeps): void` — registers `ipcMain.handle` for every command channel in `CH` and provides `push(channel, payload)` wiring to `webContents.send`.
  - `interface IpcHandlers { getInitialState(): Promise<AppState>; provision(): Promise<void>; saveKey(k: string): Promise<void>; forgetKey(): Promise<void>; goLive(): Promise<void>; stopStream(): Promise<void>; repairCapture(): Promise<void> }`
  - Preload exposes `window.axi` matching `AxiApi`, using `CH` constants.

- [ ] **Step 1: Write the failing contract test `test/ipc-contract.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { CH } from '../src/shared/state.js'
import { registerIpc } from '../src/main/ipc.js'

describe('ipc contract', () => {
  it('registers a handler for every command channel', () => {
    const handled = new Set<string>()
    const ipcMain = { handle: (ch: string) => handled.add(ch) }
    const handlers = {
      getInitialState: vi.fn(), provision: vi.fn(), saveKey: vi.fn(),
      forgetKey: vi.fn(), goLive: vi.fn(), stopStream: vi.fn(), repairCapture: vi.fn(),
    }
    registerIpc({ ipcMain: ipcMain as any, handlers: handlers as any, bindPush: () => {} })
    const commandChannels = [
      CH.getInitialState, CH.provision, CH.saveKey, CH.forgetKey,
      CH.goLive, CH.stopStream, CH.repairCapture,
    ]
    for (const ch of commandChannels) expect(handled.has(ch)).toBe(true)
  })

  it('bindPush receives a push function that targets event channels', () => {
    let push: ((ch: string, p: unknown) => void) | null = null
    registerIpc({
      ipcMain: { handle: () => {} } as any,
      handlers: {} as any,
      bindPush: (fn) => { push = fn },
    })
    expect(typeof push).toBe('function')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run test/ipc-contract.test.ts`
Expected: FAIL — cannot resolve `../src/main/ipc.js`.

- [ ] **Step 3: Implement `src/main/ipc.ts`**

```ts
import { CH, type AppState } from '../shared/state.js'

export interface IpcHandlers {
  getInitialState(): Promise<AppState>
  provision(): Promise<void>
  saveKey(key: string): Promise<void>
  forgetKey(): Promise<void>
  goLive(): Promise<void>
  stopStream(): Promise<void>
  repairCapture(): Promise<void>
}

export interface IpcDeps {
  ipcMain: { handle(ch: string, fn: (...a: any[]) => any): void }
  handlers: IpcHandlers
  bindPush(push: (channel: string, payload: unknown) => void): void
}

export function registerIpc(d: IpcDeps): void {
  const { ipcMain, handlers } = d
  ipcMain.handle(CH.getInitialState, () => handlers.getInitialState())
  ipcMain.handle(CH.provision, () => handlers.provision())
  ipcMain.handle(CH.saveKey, (_e: unknown, key: string) => handlers.saveKey(key))
  ipcMain.handle(CH.forgetKey, () => handlers.forgetKey())
  ipcMain.handle(CH.goLive, () => handlers.goLive())
  ipcMain.handle(CH.stopStream, () => handlers.stopStream())
  ipcMain.handle(CH.repairCapture, () => handlers.repairCapture())
  d.bindPush((channel, payload) => { /* bound to webContents.send by caller */ void channel; void payload })
}
```

> NOTE: the caller (Task 9 `index.ts`) overrides `bindPush` to capture a real `push` that calls `win.webContents.send(channel, payload)`. The default body above keeps the unit test free of Electron.

- [ ] **Step 4: Rewrite `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CH, type AppState, type LiveStats, type AxiApi } from '../shared/state.js'

const sub = <T,>(channel: string, cb: (p: T) => void) => {
  const listener = (_e: unknown, p: T) => cb(p)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AxiApi = {
  getInitialState: () => ipcRenderer.invoke(CH.getInitialState) as Promise<AppState>,
  provision: () => ipcRenderer.invoke(CH.provision) as Promise<void>,
  saveKey: (key) => ipcRenderer.invoke(CH.saveKey, key) as Promise<void>,
  forgetKey: () => ipcRenderer.invoke(CH.forgetKey) as Promise<void>,
  goLive: () => ipcRenderer.invoke(CH.goLive) as Promise<void>,
  stopStream: () => ipcRenderer.invoke(CH.stopStream) as Promise<void>,
  repairCapture: () => ipcRenderer.invoke(CH.repairCapture) as Promise<void>,
  onState: (cb) => sub<Partial<AppState>>(CH.evtState, cb),
  onStats: (cb) => sub<LiveStats>(CH.evtStats, cb),
  onPreview: (cb) => sub<string>(CH.evtPreview, cb),
}
contextBridge.exposeInMainWorld('axi', api)
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/app && npx vitest run test/ipc-contract.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat: IPC command/event layer + typed preload bridge"
```

---

### Task 7: Renderer shell + Stream screen state machine

**Files:**
- Create: `packages/app/src/renderer/components/Sidebar.tsx`, `StreamScreen.tsx`, `StatChips.tsx`, `KeyInput.tsx`
- Rewrite: `packages/app/src/renderer/App.tsx`, `packages/app/src/renderer/styles.css`
- Create: `packages/app/test/stream-screen.test.tsx`

**Interfaces:**
- Consumes: `createStore` (Task 2), `AppState`/`StreamPhase`/`LiveStats` (Task 2), `window.axi` (`AxiApi`).
- Produces: an `App` that subscribes to `window.axi` events into the store and renders `Sidebar` + the active screen; `StreamScreen` renders per `phase`.

- [ ] **Step 1: Write the failing test `test/stream-screen.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreamScreen } from '../src/renderer/components/StreamScreen.js'
import type { AppState } from '../src/shared/state.js'

const base: AppState = { phase: 'READY', capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 }, keyMasked: '····7f3a', stats: null, error: null }
const axi = { provision: vi.fn(), saveKey: vi.fn(), forgetKey: vi.fn(), goLive: vi.fn(), stopStream: vi.fn() }

describe('StreamScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('SETTING_UP shows the setup CTA', () => {
    render(<StreamScreen state={{ ...base, phase: 'SETTING_UP', capture: null, keyMasked: null }} preview={null} axi={axi as any} />)
    expect(screen.getByRole('button', { name: /set up capture/i })).toBeInTheDocument()
  })

  it('NEEDS_KEY shows the key input, not Go Live', () => {
    render(<StreamScreen state={{ ...base, phase: 'NEEDS_KEY', keyMasked: null }} preview={null} axi={axi as any} />)
    expect(screen.getByPlaceholderText(/stream key/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /go live/i })).not.toBeInTheDocument()
  })

  it('READY shows an enabled Go Live', () => {
    render(<StreamScreen state={base} preview={null} axi={axi as any} />)
    const btn = screen.getByRole('button', { name: /go live/i })
    expect(btn).toBeEnabled()
  })

  it('LIVE shows End Stream and the LIVE badge', () => {
    render(<StreamScreen state={{ ...base, phase: 'LIVE', stats: { bitrateKbps: 5980, droppedFrames: 0, durationMs: 767000, encoder: 'x264', cpuPct: 11, reconnecting: false } }} preview={null} axi={axi as any} />)
    expect(screen.getByRole('button', { name: /end stream/i })).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run test/stream-screen.test.tsx`
Expected: FAIL — cannot resolve `StreamScreen.js`.

- [ ] **Step 3: Implement `src/renderer/components/StatChips.tsx`**

```tsx
import type { LiveStats } from '../../shared/state.js'

export function StatChips({ stats }: { stats: LiveStats | null }) {
  const s = stats
  return (
    <div className="chips">
      <span className="chip">{s ? `▲ ${s.bitrateKbps} kbps` : '— kbps'}</span>
      <span className="chip good">{s ? `${s.droppedFrames} dropped` : '0 dropped'}</span>
      <span className="chip">{s ? `${s.encoder} · 1080p60` : 'x264 · 1080p60'}</span>
      {s ? <span className="chip">{`CPU ${s.cpuPct}%`}</span> : null}
    </div>
  )
}
```

- [ ] **Step 4: Implement `src/renderer/components/KeyInput.tsx`**

```tsx
import { useState } from 'react'

export function KeyInput({ onSave }: { onSave: (key: string) => void }) {
  const [v, setV] = useState('')
  const valid = v.trim().length >= 8
  return (
    <div className="keyrow">
      <input
        className="keyinput" placeholder="Paste your YouTube stream key" value={v}
        onChange={(e) => setV(e.target.value)} aria-label="stream key"
      />
      <button className="btn primary" disabled={!valid} onClick={() => onSave(v.trim())}>Save key</button>
    </div>
  )
}
```

- [ ] **Step 5: Implement `src/renderer/components/StreamScreen.tsx`**

```tsx
import type { AppState } from '../../shared/state.js'
import type { AxiApi } from '../../shared/state.js'
import { StatChips } from './StatChips.js'
import { KeyInput } from './KeyInput.js'

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000); const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function StreamScreen({ state, preview, axi }: { state: AppState; preview: string | null; axi: AxiApi }) {
  const { phase, capture, keyMasked, stats } = state
  const live = phase === 'LIVE' || phase === 'RECONNECTING'

  if (phase === 'SETTING_UP') {
    return (
      <div className="hero setup">
        <div className="setup-icon">▦</div>
        <h2>Set up your capture</h2>
        <p>AxiStream will ask you to pick the screen showing your game. You'll only do this once.</p>
        <button className="btn primary lg" onClick={() => axi.provision()}>Set up capture →</button>
      </div>
    )
  }

  return (
    <div className="hero" style={preview ? { backgroundImage: `url(${preview})` } : undefined}>
      <div className="hero-top">
        <span className="hero-title">Stream</span>
        {live ? <span className="badge live">● LIVE</span> : <span className="badge">● PREVIEW</span>}
        {live && stats ? <span className="pill mono">{fmt(stats.durationMs)}</span> : null}
        {capture ? <span className="pill mono">{`${capture.sourceLabel} · ${capture.width}×${capture.height} · ${capture.fps}fps`}</span> : null}
      </div>

      {phase === 'AWAITING_APPROVAL' ? (
        <div className="overlay">Approve the screen-share dialog to finish setup…</div>
      ) : null}
      {phase === 'ERROR' && state.error ? <div className="overlay error">{state.error}</div> : null}
      {phase === 'RECONNECTING' ? <div className="overlay warn">Reconnecting…</div> : null}

      <div className="hero-bottom">
        <div className="statusrow">
          <span className="dot good" /> Capture {capture ? 'ready' : '…'}
          {keyMasked ? <span className="pill mono">🔑 {keyMasked} <button className="link" onClick={() => axi.forgetKey()}>Forget</button></span> : null}
          <span className="spacer" />
          <StatChips stats={stats} />
        </div>

        {phase === 'NEEDS_KEY' ? (
          <KeyInput onSave={(k) => axi.saveKey(k)} />
        ) : live ? (
          <button className="btn danger lg" onClick={() => axi.stopStream()}>■ End Stream</button>
        ) : (
          <button className="btn primary lg" disabled={phase === 'GOING_LIVE'} onClick={() => axi.goLive()}>
            {phase === 'GOING_LIVE' ? 'Starting…' : '● Go Live'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Implement `src/renderer/components/Sidebar.tsx`**

```tsx
import type { StreamPhase } from '../../shared/state.js'

export function Sidebar({ active, phase, onNav }: { active: 'stream' | 'settings'; phase: StreamPhase; onNav: (s: 'stream' | 'settings') => void }) {
  const live = phase === 'LIVE' || phase === 'RECONNECTING'
  return (
    <div className="sidebar">
      <div className="menu-label">MENU</div>
      <button className={`navitem ${active === 'stream' ? 'on' : ''}`} onClick={() => onNav('stream')}>▶ Stream</button>
      <button className={`navitem ${active === 'settings' ? 'on' : ''}`} onClick={() => onNav('settings')}>⚙ Settings</button>
      <div className="navitem dim">▦ Privacy Masks <span className="soon">SOON</span></div>
      <div className="navitem dim">◇ Presets <span className="soon">SOON</span></div>
      <div className={`enginepill ${live ? 'onair' : ''}`}>
        <span className="dot" /> {live ? 'On air' : 'Engine ready'}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Rewrite `src/renderer/App.tsx`**

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createStore } from './store.js'
import { Sidebar } from './components/Sidebar.js'
import { StreamScreen } from './components/StreamScreen.js'
import { SettingsScreen } from './components/SettingsScreen.js'
import type { AxiApi } from '../shared/state.js'

const store = createStore()
const axi = (globalThis as unknown as { axi: AxiApi }).axi

export function App() {
  const [nav, setNav] = useState<'stream' | 'settings'>('stream')
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const preview = useSyncExternalStore(store.subscribe, store.getPreview)

  useEffect(() => {
    const offs = [
      axi.onState((p) => store.applyState(p)),
      axi.onStats((s) => store.applyStats(s)),
      axi.onPreview((d) => store.applyPreview(d)),
    ]
    axi.getInitialState().then((s) => store.applyState(s))
    return () => offs.forEach((off) => off())
  }, [])

  return (
    <div className="app">
      <div className="titlebar"><span className="brand"><span className="dot accent" /> AxiStream</span></div>
      <div className="body">
        <Sidebar active={nav} phase={state.phase} onNav={setNav} />
        {nav === 'stream'
          ? <StreamScreen state={state} preview={preview} axi={axi} />
          : <SettingsScreen state={state} axi={axi} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Implement a minimal `src/renderer/components/SettingsScreen.tsx`** (fleshed out in Task 8; stub now so App compiles)

```tsx
import type { AppState, AxiApi } from '../../shared/state.js'
export function SettingsScreen(_props: { state: AppState; axi: AxiApi }) {
  return <div className="hero settings"><h2>Settings</h2><p>Coming in the next step.</p></div>
}
```

- [ ] **Step 9: Append component styles to `src/renderer/styles.css`**

```css
.body { flex: 1; display: flex; min-height: 0; }
.sidebar { width: 188px; background: #0a0c11; border-right: 1px solid #161c25; padding: 14px 10px; display: flex; flex-direction: column; }
.menu-label { color: #5b6470; font: 700 10px/1 ui-monospace, monospace; letter-spacing: .14em; margin: 4px 8px 10px; }
.navitem { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 9px; color: #8b949e; font-size: 14px; background: none; border: 0; text-align: left; cursor: pointer; margin-top: 3px; }
.navitem.on { background: rgba(34,211,238,.1); color: #bfeef7; border: 1px solid rgba(34,211,238,.22); }
.navitem.dim { color: #586069; }
.soon { margin-left: auto; font: 600 9px/1 ui-monospace, monospace; border: 1px solid #2a323b; padding: 3px 5px; border-radius: 5px; }
.enginepill { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-radius: 9px; background: #0d1117; border: 1px solid #161c25; color: #8b949e; font: 600 11px/1 ui-monospace, monospace; }
.enginepill .dot { width: 7px; height: 7px; border-radius: 50%; background: #3fb950; }
.enginepill.onair { background: rgba(240,85,107,.08); border-color: rgba(240,85,107,.25); color: #f0a3ae; }
.enginepill.onair .dot { background: #f0556b; }
.hero { flex: 1; position: relative; overflow: hidden; background: linear-gradient(135deg,#13243a,#1c1c40 45%,#311a35 80%,#3a1f2a); background-size: cover; background-position: center; display: flex; flex-direction: column; }
.hero.setup, .hero.settings { align-items: center; justify-content: center; text-align: center; gap: 10px; background: repeating-linear-gradient(45deg,#0d1016,#0d1016 12px,#0e1118 12px,#0e1118 24px); }
.setup-icon { width: 58px; height: 58px; border-radius: 16px; background: rgba(34,211,238,.1); border: 1px solid rgba(34,211,238,.3); display: grid; place-items: center; color: #22d3ee; font-size: 26px; }
.hero-top { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 11px; padding: 14px 16px; background: linear-gradient(180deg,rgba(0,0,0,.5),transparent); }
.hero-title { color: #fff; font-weight: 800; text-shadow: 0 1px 4px #000; }
.badge { color: #9fd8ff; font: 700 10px/1 ui-monospace, monospace; border: 1px solid rgba(34,211,238,.5); padding: 5px 9px; border-radius: 20px; background: rgba(0,0,0,.3); }
.badge.live { color: #fff; background: #e23a52; border: 0; box-shadow: 0 0 14px rgba(226,58,82,.5); }
.pill { color: #dfe7ef; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.14); padding: 6px 10px; border-radius: 20px; }
.mono { font: 600 12px/1 ui-monospace, monospace; }
.hero-bottom { position: absolute; bottom: 0; left: 0; right: 0; padding: 18px 22px 22px; background: linear-gradient(0deg,rgba(0,0,0,.82),transparent); }
.statusrow { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; color: #e6edf3; font-size: 13px; text-shadow: 0 1px 2px #000; }
.statusrow .spacer { flex: 1; }
.dot.good { color: #5fe39a; } .dot.good::before { content: '●'; }
.chips { display: flex; gap: 8px; } .chip { color: #cdd6e0; background: rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.12); padding: 7px 10px; border-radius: 9px; font: 600 11px/1 ui-monospace, monospace; } .chip.good { color: #7be3a0; }
.keyrow { display: flex; gap: 10px; } .keyinput { flex: 1; background: rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.14); border-radius: 11px; padding: 14px; color: #e6edf3; font-size: 14px; }
.btn { border: 0; border-radius: 12px; padding: 14px 20px; font-weight: 800; cursor: pointer; } .btn.lg { width: 100%; padding: 17px; font-size: 17px; } .btn.primary { background: linear-gradient(180deg,#26d3ee,#0bb6d6); color: #06222a; } .btn.primary:disabled { opacity: .55; cursor: default; } .btn.danger { background: rgba(226,58,82,.16); color: #ff8b9c; border: 1px solid #f0556b; }
.link { background: none; border: 0; color: #9fd8ff; cursor: pointer; font: inherit; }
.overlay { position: absolute; inset: auto 0 120px; text-align: center; color: #dfe7ef; text-shadow: 0 1px 3px #000; } .overlay.error { color: #ff9aa8; } .overlay.warn { color: #ffd479; }
.brand { display: flex; align-items: center; gap: 8px; } .dot.accent { width: 9px; height: 9px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 10px #22d3ee; }
```

- [ ] **Step 10: Run to verify it passes**

Run: `cd packages/app && npx vitest run test/stream-screen.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 11: Commit**

```bash
git add packages/app/src/renderer
git commit -m "feat: renderer shell + Stream screen state machine"
```

---

### Task 8: Settings screen (key management + repair)

**Files:**
- Rewrite: `packages/app/src/renderer/components/SettingsScreen.tsx`
- Test: `packages/app/test/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `AppState`, `AxiApi`, `KeyInput`.
- Produces: `SettingsScreen` showing key state (saved+Forget OR a KeyInput to add one), a "Re-set up capture" button (`repairCapture`), and engine/version info.

- [ ] **Step 1: Write the failing test `test/settings-screen.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsScreen } from '../src/renderer/components/SettingsScreen.js'
import type { AppState } from '../src/shared/state.js'

const axi = { forgetKey: vi.fn(), saveKey: vi.fn(), repairCapture: vi.fn() }
const base: AppState = { phase: 'READY', capture: null, keyMasked: '····7f3a', stats: null, error: null }

describe('SettingsScreen', () => {
  it('shows the saved key with a Forget action', () => {
    render(<SettingsScreen state={base} axi={axi as any} />)
    expect(screen.getByText(/····7f3a/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /forget/i }))
    expect(axi.forgetKey).toHaveBeenCalledOnce()
  })
  it('shows a key input when no key is saved', () => {
    render(<SettingsScreen state={{ ...base, keyMasked: null }} axi={axi as any} />)
    expect(screen.getByPlaceholderText(/stream key/i)).toBeInTheDocument()
  })
  it('offers Re-set up capture', () => {
    render(<SettingsScreen state={base} axi={axi as any} />)
    fireEvent.click(screen.getByRole('button', { name: /re-set up capture/i }))
    expect(axi.repairCapture).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run test/settings-screen.test.tsx`
Expected: FAIL — current stub has no such elements.

- [ ] **Step 3: Implement `src/renderer/components/SettingsScreen.tsx`**

```tsx
import type { AppState, AxiApi } from '../../shared/state.js'
import { KeyInput } from './KeyInput.js'

export function SettingsScreen({ state, axi }: { state: AppState; axi: AxiApi }) {
  return (
    <div className="hero settings-panel">
      <div className="settings-inner">
        <h2>Settings</h2>

        <section className="setting">
          <h3>YouTube stream key</h3>
          {state.keyMasked ? (
            <div className="keyrow saved">
              <span className="pill mono">🔑 {state.keyMasked}</span>
              <button className="btn" onClick={() => axi.forgetKey()}>Forget</button>
            </div>
          ) : (
            <KeyInput onSave={(k) => axi.saveKey(k)} />
          )}
        </section>

        <section className="setting">
          <h3>Capture</h3>
          <p className="muted">Re-run setup if you changed monitors or the capture stopped working.</p>
          <button className="btn" onClick={() => axi.repairCapture()}>Re-set up capture</button>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Append styles to `src/renderer/styles.css`**

```css
.settings-panel { display: block; background: #0c0f15; overflow: auto; }
.settings-inner { max-width: 520px; padding: 26px; }
.settings-inner h2 { margin: 0 0 18px; }
.setting { background: #0e131a; border: 1px solid #1d2530; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
.setting h3 { margin: 0 0 10px; font-size: 14px; color: #c7d0d9; }
.keyrow.saved { display: flex; align-items: center; gap: 12px; }
.muted { color: #768390; font-size: 13px; margin: 0 0 12px; }
.btn { background: #1a222c; color: #c7d0d9; border: 1px solid #2a323b; }
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/app && npx vitest run test/settings-screen.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/components/SettingsScreen.tsx packages/app/src/renderer/styles.css packages/app/test/settings-screen.test.tsx
git commit -m "feat: Settings screen (key management + repair)"
```

---

### Task 9: Main wiring + boot orchestration + e2e smoke

**Files:**
- Rewrite: `packages/app/src/main/index.ts`
- Create: `packages/app/test/e2e/launch.e2e.ts`, `packages/app/playwright.config.ts`
- Create: `packages/app/docs/app-testing.md`

**Interfaces:**
- Consumes: all main services + `registerIpc` + `@axistream/capture` (`ObsSidecar`, `Provisioner`, `FlatpakObsLauncher`, `CaptureConfig`), Electron `safeStorage`, `app`.
- Produces: a fully wired app — boot `CaptureService`, derive initial phase from provisioned+key, push state/stats/preview, handle commands, quit-while-live guard.

- [ ] **Step 1: Rewrite `src/main/index.ts`** (full wiring)

```ts
import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron'
import { join } from 'node:path'
import { ObsSidecar, Provisioner, FlatpakObsLauncher, CaptureConfig } from '@axistream/capture'
import { CaptureService } from './CaptureService.js'
import { StreamController } from './StreamController.js'
import { KeyStore } from './KeyStore.js'
import { PreviewPump } from './PreviewPump.js'
import { registerIpc, type IpcHandlers } from './ipc.js'
import { CH, INITIAL_STATE, type AppState } from '../shared/state.js'

const CAPTURE_SOURCE = 'AxiStream Capture'
let state: AppState = { ...INITIAL_STATE }

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960, height: 620, frame: false, backgroundColor: '#0b0d12', show: false,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(async () => {
  const win = createWindow()
  const push = (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload) }
  const setState = (p: Partial<AppState>) => { state = { ...state, ...p }; push(CH.evtState, p) }

  const keyStore = new KeyStore(join(app.getPath('userData'), 'key.bin'), safeStorage)
  const config = new CaptureConfig(join(app.getPath('userData'), 'capture.json'))
  const sidecar = new ObsSidecar({ launcher: new FlatpakObsLauncher(), collection: 'AxiStream' })

  const preview = new PreviewPump({ client: () => sidecar.client(), sourceName: CAPTURE_SOURCE, emit: (d) => push(CH.evtPreview, d) })
  win.on('hide', () => preview.setVisible(false))
  win.on('show', () => preview.setVisible(true))
  win.on('minimize', () => preview.setVisible(false))
  win.on('restore', () => preview.setVisible(true))

  const capture = new CaptureService({
    sidecar,
    makeProvisioner: () => new Provisioner({ sidecar, config, platform: process.platform }),
    onApprovalNeeded: () => setState({ phase: 'AWAITING_APPROVAL' }),
    onPhase: (p, error) => setState({ phase: p, error: error ?? null }),
    onCrashed: () => setState({ phase: 'ERROR', error: 'Stream engine crashed — restart AxiStream.' }),
  })

  const stream = new StreamController({
    client: () => sidecar.client(),
    onPhase: (p, error) => setState({ phase: p, error: error ?? null }),
    onStats: (s) => push(CH.evtStats, s),
  })

  const goReadyPhase = () => keyStore.masked() ? 'READY' : 'NEEDS_KEY'

  const handlers: IpcHandlers = {
    getInitialState: async () => state,
    provision: async () => { const ok = await capture.provision(); if (ok) { setState({ phase: goReadyPhase(), keyMasked: keyStore.masked(), capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 } }); preview.start() } },
    saveKey: async (key) => { keyStore.save(key); setState({ keyMasked: keyStore.masked(), phase: state.phase === 'NEEDS_KEY' ? 'READY' : state.phase }) },
    forgetKey: async () => { keyStore.forget(); setState({ keyMasked: null, phase: state.phase === 'READY' ? 'NEEDS_KEY' : state.phase }) },
    goLive: async () => { const key = keyStore.load(); if (!key) { setState({ phase: 'NEEDS_KEY' }); return } await stream.goLive(key) },
    stopStream: async () => { await stream.stop() },
    repairCapture: async () => { setState({ phase: 'SETTING_UP' }) },
  }
  registerIpc({ ipcMain, handlers, bindPush: () => {} })

  // Boot the engine, then derive the initial phase.
  try {
    await capture.start()
    const provisioned = config.load().provisioned
    if (provisioned) {
      setState({ phase: keyStore.masked() ? 'READY' : 'NEEDS_KEY', keyMasked: keyStore.masked(), capture: { sourceLabel: 'Guild Wars 2', width: 1920, height: 1080, fps: 60 } })
      preview.start()
    } else {
      setState({ phase: 'SETTING_UP' })
    }
  } catch (e) {
    setState({ phase: 'ERROR', error: 'Could not start the stream engine (OBS).' })
  }

  win.on('close', (e) => {
    if (stream.isLive()) {
      const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Stay live', 'End stream & quit'], defaultId: 0, cancelId: 0, message: "You're still live — end stream and quit?" })
      if (choice === 0) { e.preventDefault(); return }
    }
    preview.stop()
    void sidecar.stop()
  })

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

> NOTE: `registerIpc`'s `bindPush` is unused here because `index.ts` owns `push` directly (closure over `win`). The `bindPush` seam exists only so the Task 6 contract test can run without Electron; passing a no-op is correct.

- [ ] **Step 2: Verify the app boots and the unit suite passes**

Run: `cd packages/app && npx vitest run`
Expected: all unit tests pass (store, key-store, stream-controller, capture-service, preview-pump, ipc-contract, stream-screen, settings-screen).
Then: `npm -w @axistream/app run dev` — the window opens; with no provisioned capture it shows the **Set up your capture** CTA. (Full capture/stream behavior needs real OBS — covered by the e2e + manual path below.) Close it.

- [ ] **Step 3: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './test/e2e', timeout: 120000, fullyParallel: false, workers: 1 })
```
Install: `npm -w @axistream/app i -D @playwright/test`

- [ ] **Step 4: Create the e2e smoke `test/e2e/launch.e2e.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'

// Boots the built app and asserts the shell renders + reaches a known phase.
// Returning-user capture/stream paths need real OBS + a provisioned AxiStream
// collection (see docs/app-testing.md); first-run portal approval is manual.
test('app boots and shows the shell', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const win = await app.firstWindow()
  await expect(win.locator('.brand')).toContainText('AxiStream')
  // Unprovisioned first run shows the setup CTA:
  await expect(win.getByRole('button', { name: /set up capture/i })).toBeVisible({ timeout: 60000 })
  await app.close()
})
```

- [ ] **Step 5: Build and run the e2e smoke**

```bash
npm -w @axistream/app run build
npm -w @axistream/app exec playwright test
```
Expected: PASS — the window shows "AxiStream" and the setup CTA. (If a leftover provisioned `AxiStream` collection exists from earlier, the app may land on NEEDS_KEY/READY instead; the test asserts the shell, and the doc explains the variants.)

- [ ] **Step 6: Write `docs/app-testing.md`**

```markdown
# AxiStream App — Testing

## Unit (CI): `npm -w @axistream/app run test` — jsdom + mocked window.axi/services.
## E2e shell smoke (local): `npm -w @axistream/app run build && npm -w @axistream/app exec playwright test`
## Manual full-path (real OBS, Wayland portal): launch `npm -w @axistream/app run dev`,
  click "Set up capture", approve the screen-share dialog (check Remember), paste a
  YouTube stream key, click Go Live, confirm the stream on YouTube, End Stream.
  First-run portal approval cannot be automated.
```

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/main/index.ts packages/app/test/e2e packages/app/playwright.config.ts packages/app/docs/app-testing.md packages/app/package.json packages/app/package-lock.json
git commit -m "feat: main wiring + boot orchestration + e2e shell smoke"
```

---

## Self-Review

**Spec coverage:**
- Workspaces (`capture` + `app`) → Task 1.
- main/preload/renderer split, security flags → Tasks 1, 6, 9.
- `CaptureService`, `StreamController`, `KeyStore`, `PreviewPump` → Tasks 3–5.
- IPC command/event contract + typed preload → Task 6 (channels/types from `CH`/`AxiApi` defined in Task 2).
- Stream state machine (all 8 phases) + Settings → Tasks 7–8 (SETTING_UP/NEEDS_KEY/READY/LIVE tested; AWAITING_APPROVAL/RECONNECTING/ERROR/GOING_LIVE rendered in `StreamScreen`).
- Secure key + Forget + fallback → Task 3 (+ wired in Task 9).
- Live status with preview thumbnail → Tasks 4, 5, 7, 9.
- Error handling (engine fail, go-live timeout, reconnect, crash, quit-while-live, safeStorage-unavailable) → Tasks 4, 9 (+ KeyStore fallback Task 3).
- Testing strategy (renderer, store, main units, IPC contract, e2e) → every task + Task 9.
- Visual direction → Task 7 styles (cyan accent, sidebar shell, cinematic hero).

**Placeholder scan:** No TBD/echo placeholders; every code step carries complete code. The two `bindPush` no-ops are intentional seams, documented inline.

**Type consistency:** `StreamPhase`, `AppState`, `LiveStats`, `CaptureMeta`, `AxiApi`, `CH` are defined once in `src/shared/state.ts` (Task 2) and consumed unchanged by main (Tasks 3–6, 9), preload (Task 6), and renderer (Tasks 7–8). Channel names flow from `CH`. `CAPTURE_SOURCE` = `'AxiStream Capture'` matches the capture library's `Provisioner` constant. `goLive()` takes no args at the IPC layer (key read from `KeyStore` in main); `StreamController.goLive(key)` takes the key — the boundary is the `goLive` handler in Task 9.

**One deferred behavior flagged:** capture meta (resolution/fps) is hardcoded to 1920×1080×60 for v1 (the capture source is monitor capture; OBS exposes true dimensions via the source — wiring real values is a small follow-up, noted so it isn't mistaken for a gap).

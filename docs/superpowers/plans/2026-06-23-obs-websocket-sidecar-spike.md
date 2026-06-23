# OBS-Sidecar-over-obs-websocket Health Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **This is a SPIKE, not a feature.** The deliverable is *knowledge and a go/no-go decision*, not shippable product code. There is no TDD red-green cycle — each task's "test" is a runnable probe whose printed output answers a specific risk question. All probe code is throwaway and lives under `spike/`. Nothing here is meant to survive into the real app.

> **Context — why this plan replaced the obs-studio-node one:** obs-studio-node supports only Windows + macOS (its README: *"Currently, only Windows and MacOS are supported."*). That breaks AxiStream's cross-platform scope and blocks local dev on the maintainer's Linux/Wayland box. Decision (2026-06-23): drive a **bundled OBS Studio instance over obs-websocket** instead. OBS Studio is fully cross-platform (incl. Linux/Wayland/PipeWire), so we inherit the hard capture work instead of owning it.

**Goal:** Determine within a few days whether AxiStream can launch and control a bundled OBS Studio as a background sidecar, entirely over obs-websocket (v5), to capture a screen/window, hardware-encode, and stream to YouTube RTMPS — on **both Linux (Bazzite/Wayland) and Windows** — and whether OBS can run hidden/unobtrusively enough to feel like one app.

**Architecture:** A throwaway minimal Electron app under `spike/` that spawns OBS as a child process with the WebSocket server enabled via CLI flags, then connects with `obs-websocket-js` and drives everything (scenes, capture sources, stream settings, start/stop) through the JSON protocol. No native bindings. We validate Linux and Windows **in parallel**; "works on both" is the pass bar.

**Tech Stack:** Electron, `obs-websocket-js` (v5 client, npm), OBS Studio 28+ (built-in obs-websocket v5), PipeWire + xdg-desktop-portal (Linux/Wayland capture path), YouTube Live RTMPS endpoint.

## Global Constraints

- **Cross-platform is the whole point of this pivot:** the spike passes only if the core path works on **both** Linux and Windows. macOS validated later; don't design probes in a way that blocks it.
- **OBS is a managed dependency, driven only over the socket:** the spike must never require a human to click inside OBS to make a probe pass (the one allowed exception is a *first-run* OS-level PipeWire portal prompt on Wayland — and Task 2 explicitly tests whether that approval persists so it's one-time).
- **Enable the WebSocket server headlessly:** use OBS CLI flags `--websocket_port`, `--websocket_password` (and `--websocket_debug` while spiking). Do not rely on the Tools → WebSocket Server Settings GUI toggle.
- **OBS 28+ only:** obs-websocket v5 is built in from OBS 28. Record the exact OBS version used; the protocol is versioned and request fields can differ across minor versions.
- **No OAuth, no GW2 state reads:** out of scope. RTMPS test uses a manually pasted YouTube stream key + `rtmps://a.rtmps.youtube.com/live2`.
- **Throwaway code:** everything under `spike/`, `.gitignore`-able except `spike/FINDINGS.md`.
- **Dev host reality:** Bazzite = Fedora Atomic (KDE Kinoite), immutable FS, Wayland, PipeWire. The natural OBS install is **Flatpak `com.obsproject.Studio`** — the spike must confirm Electron can launch the Flatpak OBS and reach its WebSocket on `127.0.0.1`.
- **Decision artifact required:** spike is not done until `spike/FINDINGS.md` has a per-platform pass/fail table, a verdict on hidden/headless operation + bundling footprint, and an explicit GO / GO-WITH-CAVEATS / NO-GO.

## New risks this approach introduces (the spike must answer these)

1. **Can OBS run hidden/unobtrusive** (minimized to tray / offscreen) and still render capture, so AxiStream feels like one app rather than "launches OBS in your face"?
2. **Wayland portal persistence** — does the PipeWire screen-share approval survive restarts via OBS's restore token, so the user approves once, not every launch?
3. **Bundling footprint & acquisition** — how big is OBS to ship, and on Bazzite does Flatpak OBS cooperate with a child-process + localhost-socket control model?
4. **Encoder control depth over the socket** — obs-websocket exposes stream *service* settings readily; encoder selection largely lives in OBS *profiles*. Confirm we can select hardware vs software encode in a controllable way.

## Decision Gates (read before starting)

Hard gates (KILL = stop, escalate, don't build further): Task 1 (launch + connect), Task 2 (create capture source), Task 3 (non-black frames). Soft gates (failure = caveat, not kill): Task 4 (encoders), Task 5 (RTMPS live).

---

## File Structure

- `spike/package.json` — Electron + obs-websocket-js, run scripts.
- `spike/obs-launch.js` — locate + spawn OBS as a child process with WebSocket flags; resolve when the socket is reachable; tear down on exit.
- `spike/main.js` — Electron main entry; runs a named probe, writes results to `spike/out/<platform>-<probe>.json`, exits.
- `spike/probes/00-env.js` — OS/session/versions + how OBS was located.
- `spike/probes/01-connect.js` — launch OBS, connect+auth, GetVersion, clean shutdown.
- `spike/probes/02-source.js` — enumerate input kinds, create scene + screen-capture input, handle/persist Wayland portal.
- `spike/probes/03-frames.js` — GetSourceScreenshot → decode → assert non-black.
- `spike/probes/04-encoders.js` — enumerate encoders/outputs, classify hw vs sw.
- `spike/probes/05-rtmps.js` — set YouTube RTMPS service, StartStream, assert active, StopStream.
- `spike/out/<platform>-<probe>.json` — machine-written results.
- `spike/FINDINGS.md` — the human-written go/no-go synthesis. **The real deliverable.**

---

### Task 0: Scaffold the spike app + OBS acquisition + env capture

**Files:**
- Create: `spike/package.json`, `spike/main.js`, `spike/obs-launch.js`, `spike/probes/00-env.js`, `spike/.gitignore`

**Interfaces:**
- Produces: `npm --prefix spike start -- 00-env` boots Electron, runs a probe, writes `spike/out/<platform>-00-env.json`, exits. And `obs-launch.js` exporting `launchObs({port,password}) -> {proc, disconnect()}` and `findObsCommand() -> {cmd, args[]}`.

- [ ] **Step 1: Decide how OBS is obtained per platform (record, don't guess)**

- Linux/Bazzite: install Flatpak OBS — `flatpak install -y flathub com.obsproject.Studio`. Launch form: `flatpak run com.obsproject.Studio <flags>`. Record OBS version (`flatpak run com.obsproject.Studio --version` or via GetVersion later).
- Windows: install OBS Studio 28+ (or use a portable build). Launch form: `"C:\Program Files\obs-studio\bin\64bit\obs64.exe"` with `--multi --disable-shutdown-check`. OBS on Windows must be started from its `bin/64bit` dir (it resolves data relatively) — `obs-launch.js` must set `cwd` accordingly.

- [ ] **Step 2: Write `spike/package.json`**

```json
{
  "name": "axistream-spike",
  "private": true,
  "version": "0.0.0",
  "main": "main.js",
  "scripts": { "start": "electron ." },
  "devDependencies": { "electron": "^31.0.0" },
  "dependencies": { "obs-websocket-js": "^5.0.6" }
}
```

- [ ] **Step 3: Write `spike/obs-launch.js`**

```js
const { spawn } = require('child_process')
const net = require('net')

function findObsCommand() {
  if (process.platform === 'linux') {
    return { cmd: 'flatpak', args: ['run', 'com.obsproject.Studio'], cwd: undefined }
  }
  if (process.platform === 'win32') {
    const exe = 'C\\:/Program Files/obs-studio/bin/64bit/obs64.exe'.replace('C\\:', 'C:')
    return { cmd: exe, args: [], cwd: 'C:/Program Files/obs-studio/bin/64bit' }
  }
  throw new Error(`unsupported platform ${process.platform}`)
}

function waitForPort(port, timeoutMs) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); resolve(true) })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() - start > timeoutMs) return reject(new Error('OBS websocket port never opened'))
        setTimeout(tryOnce, 500)
      })
    }
    tryOnce()
  })
}

async function launchObs({ port, password }) {
  const { cmd, args, cwd } = findObsCommand()
  const obsArgs = [
    ...args,
    '--websocket_port', String(port),
    '--websocket_password', password,
    '--websocket_debug',
    '--multi',                 // allow running alongside any existing OBS
    '--disable-shutdown-check',
    '--minimize-to-tray',      // probe #1 for "hidden" operation
  ]
  const proc = spawn(cmd, obsArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout.on('data', d => process.stdout.write(`[obs] ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`[obs] ${d}`))
  await waitForPort(port, 30000)
  return {
    proc,
    disconnect() { try { proc.kill() } catch (_) {} },
  }
}

module.exports = { launchObs, findObsCommand }
```

- [ ] **Step 4: Write `spike/main.js`**

```js
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const probeName = process.argv.find(a => /^\d\d-/.test(a)) || '00-env'
const platform = process.platform
const outDir = path.join(__dirname, 'out')
fs.mkdirSync(outDir, { recursive: true })

app.whenReady().then(async () => {
  let result
  try {
    const probe = require(`./probes/${probeName}.js`)
    result = await probe({ platform, os })
    result.ok = result.ok !== false
  } catch (err) {
    result = { ok: false, error: String((err && err.stack) || err) }
  }
  const file = path.join(outDir, `${platform}-${probeName}.json`)
  fs.writeFileSync(file, JSON.stringify(result, null, 2))
  console.log(`[spike] wrote ${file}`)
  app.quit()
})
```

- [ ] **Step 5: Write `spike/probes/00-env.js`**

```js
const { findObsCommand } = require('../obs-launch')
module.exports = async function envProbe({ os }) {
  let obsCmd = null, obsErr = null
  try { obsCmd = findObsCommand() } catch (e) { obsErr = String(e) }
  return {
    ok: !!obsCmd,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    session: process.env.XDG_SESSION_TYPE || null, // 'wayland' on Bazzite
    desktop: process.env.XDG_CURRENT_DESKTOP || null,
    osRelease: os.release(),
    obsCmd, obsErr,
  }
}
```

- [ ] **Step 6: Write `spike/.gitignore`**

```
node_modules/
out/
```

- [ ] **Step 7: Install + run the env probe (BOTH platforms)**

```bash
npm --prefix spike install
npm --prefix spike start -- 00-env
```
Expected: exits 0; `spike/out/<platform>-00-env.json` shows the resolved OBS command and (on Bazzite) `"session": "wayland"`.

- [ ] **Step 8: Commit**

```bash
git add spike/package.json spike/main.js spike/obs-launch.js spike/probes/00-env.js spike/.gitignore
git commit -m "spike: scaffold OBS-sidecar probe harness + obs-websocket client"
```

---

### Task 1: Launch OBS as a sidecar, connect + authenticate, clean shutdown (HARD GATE)

**Files:**
- Create: `spike/probes/01-connect.js`

**Interfaces:**
- Consumes: `launchObs` from Task 0.
- Produces: confirmation that OBS starts with the WebSocket server enabled via CLI flags, that `obs-websocket-js` connects + authenticates, `GetVersion` returns, and OBS exits cleanly when the child process is killed.

- [ ] **Step 1: Write `spike/probes/01-connect.js`**

```js
const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455
const PASSWORD = 'spikepw123'

module.exports = async function connectProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    const { obsWebSocketVersion, negotiatedRpcVersion } =
      await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    const ver = await obs.call('GetVersion')
    return {
      ok: true,
      obsWebSocketVersion,
      negotiatedRpcVersion,
      obsVersion: ver.obsVersion,
      platform: ver.platform,
      supportedImageFormats: ver.supportedImageFormats,
      availableRequests: Array.isArray(ver.availableRequests) ? ver.availableRequests.length : null,
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
```

- [ ] **Step 2: Run the probe (BOTH platforms)**

```bash
npm --prefix spike start -- 01-connect
```
Expected: `spike/out/<platform>-01-connect.json` with `ok: true`, a real `obsVersion`, and `negotiatedRpcVersion: 1`.

- [ ] **Step 3: Evaluate the gate**

- **PASS:** connect + GetVersion succeed on **both** platforms; OBS process is gone after the run (no orphaned obs64/flatpak process — verify with `pgrep -fa obs` / Task Manager).
- **KILL:** CLI flags don't enable the server (port never opens) and no headless enable path exists; or Flatpak OBS can't be reached on `127.0.0.1` from Electron. If the flags don't auto-enable the server, try pre-seeding `global.ini` (`[OBSWebSocket] ServerEnabled=true`) while OBS is stopped, and record which method worked — that's a real packaging finding.

- [ ] **Step 4: Record finding + commit**

Create `spike/FINDINGS.md`, note per-platform connect result + which enable method worked + whether OBS shut down cleanly.
```bash
git add spike/probes/01-connect.js spike/FINDINGS.md
git commit -m "spike: launch OBS sidecar + connect over obs-websocket"
```

---

### Task 2: Create a scene + screen-capture source over the socket; persist Wayland portal (HARD GATE)

**Files:**
- Create: `spike/probes/02-source.js`

**Interfaces:**
- Consumes: connect flow from Task 1.
- Produces: a scene containing a screen-capture input created entirely over the socket; the discovered input-kind id for screen capture on this platform (written to results for Task 3/5 to reuse); and a verdict on whether the Wayland PipeWire portal approval persists across an OBS restart.

- [ ] **Step 1: Write `spike/probes/02-source.js`**

```js
const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const SCREEN_KIND_HINTS = [
  'monitor_capture',                  // Windows
  'pipewire-desktop-capture-source',  // Linux Wayland (PipeWire screen)
  'xshm_input',                       // Linux X11
  'screen_capture', 'display_capture' // macOS / generic
]
const sleep = ms => new Promise(r => setTimeout(r, ms))

module.exports = async function sourceProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    const { inputKinds } = await obs.call('GetInputKindList')
    const screenKind = SCREEN_KIND_HINTS.find(k => inputKinds.includes(k))
    if (!screenKind) return { ok: false, reason: 'no screen-capture input kind registered', inputKinds }

    const sceneName = 'axistream-spike-scene'
    await obs.call('CreateScene', { sceneName })
    await obs.call('CreateInput', {
      sceneName, inputName: 'spike-capture', inputKind: screenKind, inputSettings: {},
    })

    // On Wayland this is when the xdg-desktop-portal screen-share dialog appears.
    await sleep(9000)

    // Confirm the input exists and report its settings (restore token lives here on Wayland).
    const { inputSettings } = await obs.call('GetInputSettings', { inputName: 'spike-capture' })

    return {
      ok: true,
      screenKind,
      inputKinds,
      inputSettings,
      note: 'On Wayland, confirm a portal dialog appeared and selection succeeded. inputSettings should contain a restore token after approval.',
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
```

- [ ] **Step 2: Run the probe (BOTH platforms)**

```bash
npm --prefix spike start -- 02-source
```
Expected: `screenKind` resolved; on Bazzite/Wayland the portal dialog appears, you approve a screen, and `inputSettings` afterwards contains a restore token.

- [ ] **Step 3: Run it a SECOND time on Linux to test portal persistence**

```bash
npm --prefix spike start -- 02-source
```
Expected: **no second portal prompt** (OBS reuses the restore token). If it prompts every time, that's a UX finding for the real app (user would re-approve each launch).

- [ ] **Step 4: Evaluate the gate**

- **PASS:** screen-capture input kind exists and a source is created via the socket on both platforms; on Wayland the portal approval persists across restart (or a persist mechanism is identified).
- **KILL:** no screen-capture kind registered (e.g. a stripped OBS build), or the source can't be created over the socket at all.

- [ ] **Step 5: Record finding + commit**

```bash
git add spike/probes/02-source.js spike/FINDINGS.md
git commit -m "spike: create capture source via socket + test Wayland portal persistence"
```

---

### Task 3: Prove non-black frames via GetSourceScreenshot (HARD GATE, automated)

**Files:**
- Create: `spike/probes/03-frames.js`

**Interfaces:**
- Consumes: a screen-capture source created as in Task 2 (recreate it within this probe; pass the kind via `SPIKE_SCREEN_KIND` env or re-discover).
- Produces: an automated assertion that the capture renders real pixels — `GetSourceScreenshot` returns a PNG whose pixels are not uniformly black. No human eyeballing required.

- [ ] **Step 1: Write `spike/probes/03-frames.js`**

```js
const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Decode a base64 PNG data URL and decide if it's effectively all-black.
// We avoid image libs: sample the raw base64 payload size + byte variance as a
// coarse proxy, then do a proper check by writing the PNG and reading a few
// bytes. Simpler robust approach: ask OBS for a small screenshot and inspect
// that the decoded buffer has meaningful non-zero variance.
function pngLooksNonBlack(dataUrl) {
  const b64 = dataUrl.split(',')[1] || ''
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 200) return false
  // Count distinct byte values across the compressed stream; an all-black frame
  // compresses to a tiny, low-entropy buffer. Require both size and variety.
  const seen = new Set()
  for (let i = 0; i < buf.length; i += 7) seen.add(buf[i])
  return buf.length > 2000 && seen.size > 20
}

module.exports = async function framesProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    const { inputKinds } = await obs.call('GetInputKindList')
    const screenKind = (process.env.SPIKE_SCREEN_KIND) ||
      ['monitor_capture','pipewire-desktop-capture-source','xshm_input','screen_capture','display_capture']
        .find(k => inputKinds.includes(k))

    const sceneName = 'axistream-spike-scene-frames'
    await obs.call('CreateScene', { sceneName })
    await obs.call('CreateInput', { sceneName, inputName: 'spike-capture', inputKind: screenKind, inputSettings: {} })
    await sleep(9000) // capture warm-up + any portal

    const shot = await obs.call('GetSourceScreenshot', {
      sourceName: 'spike-capture',
      imageFormat: 'png',
      imageWidth: 640,
    })
    const nonBlack = pngLooksNonBlack(shot.imageData)
    return {
      ok: nonBlack,
      screenKind,
      imageBytes: (shot.imageData || '').length,
      nonBlack,
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
```

- [ ] **Step 2: Run the probe (BOTH platforms)**

```bash
SPIKE_SCREEN_KIND=monitor_capture npm --prefix spike start -- 03-frames                 # Windows
SPIKE_SCREEN_KIND=pipewire-desktop-capture-source npm --prefix spike start -- 03-frames  # Linux Wayland
```
Expected: `nonBlack: true` on both. (Have something non-black on screen during the run.)

- [ ] **Step 3: Evaluate the gate**

- **PASS:** `nonBlack: true` on both platforms — proves the full capture→render path works through OBS over the socket.
- **KILL:** screenshots are empty/all-black and can't be made to render (e.g. Wayland capture returns black despite portal approval). If Wayland is black but X11 works, record whether requiring an X11 session is an acceptable v1 constraint.

- [ ] **Step 4: Record finding + commit**

```bash
git add spike/probes/03-frames.js spike/FINDINGS.md
git commit -m "spike: prove non-black capture via GetSourceScreenshot on both platforms"
```

---

### Task 4: Enumerate + classify encoders (hardware vs software) (SOFT GATE)

**Files:**
- Create: `spike/probes/04-encoders.js`

**Interfaces:**
- Consumes: connect flow from Task 1.
- Produces: the set of stream encoders OBS exposes, classified hw vs sw, and a note on how encoder selection is controllable (profile-level vs over-socket) — feeding the later GW2-preset work.

- [ ] **Step 1: Write `spike/probes/04-encoders.js`**

```js
const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const HW_HINTS = ['nvenc', 'amf', 'qsv', 'vaapi', 'videotoolbox', 'jim_nvenc']

module.exports = async function encodersProbe() {
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)
    // obs-websocket doesn't list raw encoder kinds directly; the stream output's
    // available encoders are profile-driven. Probe what we CAN read over the
    // socket and record the gap for the real app's design.
    let streamStatus = null, outputList = null, gap = null
    try { streamStatus = await obs.call('GetStreamStatus') } catch (e) { gap = String(e) }
    try { outputList = await obs.call('GetOutputList') } catch (e) { /* may not exist in this version */ }

    return {
      ok: true,
      streamStatus,
      outputList,
      note: 'Encoder selection in OBS is profile-level. Record whether AxiStream will ship pre-baked OBS profiles (GW2 presets) vs flip settings over the socket. HW classification below is a hint list for that design.',
      hwHints: HW_HINTS,
      gap,
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
```

- [ ] **Step 2: Run the probe (BOTH platforms)**

```bash
npm --prefix spike start -- 04-encoders
```
Expected: probe succeeds and records what's readable over the socket.

- [ ] **Step 3: Evaluate the gate**

- **PASS (design note, not a hard bar):** confirm the mechanism by which AxiStream will control encoders — most likely **shipping pre-baked OBS profiles** (your GW2 presets) and selecting them, since obs-websocket's encoder control is limited. Record this explicitly; it shapes step 3 of the master ordering.
- **CAVEAT:** if neither socket control nor profile-swapping cleanly selects a hardware encoder, note it — software x264 still satisfies the "must stream" bar.

- [ ] **Step 4: Record finding + commit**

```bash
git add spike/probes/04-encoders.js spike/FINDINGS.md
git commit -m "spike: probe encoder controllability over obs-websocket"
```

---

### Task 5: Configure YouTube RTMPS + go live, verify, stop (SOFT GATE)

**Files:**
- Create: `spike/probes/05-rtmps.js`

**Interfaces:**
- Consumes: connect flow + a capture scene + an encoder-capable profile.
- Produces: confirmation that setting the stream service to YouTube RTMPS over the socket and calling `StartStream` actually goes live (`GetStreamStatus.outputActive === true`, not reconnecting), with YouTube Studio showing video.

- [ ] **Step 1: Get a YouTube stream key**

YouTube Studio → Go Live → Stream → copy stream key into `SPIKE_YT_KEY`. **Never commit it.**

- [ ] **Step 2: Write `spike/probes/05-rtmps.js`**

```js
const { OBSWebSocket } = require('obs-websocket-js')
const { launchObs } = require('../obs-launch')

const PORT = 4455, PASSWORD = 'spikepw123'
const sleep = ms => new Promise(r => setTimeout(r, ms))

module.exports = async function rtmpsProbe() {
  const key = process.env.SPIKE_YT_KEY
  if (!key) return { ok: false, error: 'SPIKE_YT_KEY not set' }
  const handle = await launchObs({ port: PORT, password: PASSWORD })
  const obs = new OBSWebSocket()
  try {
    await obs.connect(`ws://127.0.0.1:${PORT}`, PASSWORD)

    // Build a capture scene so the stream isn't black.
    const { inputKinds } = await obs.call('GetInputKindList')
    const screenKind = (process.env.SPIKE_SCREEN_KIND) ||
      ['monitor_capture','pipewire-desktop-capture-source','xshm_input'].find(k => inputKinds.includes(k))
    const sceneName = 'axistream-spike-stream'
    await obs.call('CreateScene', { sceneName })
    await obs.call('SetCurrentProgramScene', { sceneName })
    await obs.call('CreateInput', { sceneName, inputName: 'spike-capture', inputKind: screenKind, inputSettings: {} })
    await sleep(8000)

    // Point OBS at YouTube RTMPS.
    await obs.call('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: 'rtmps://a.rtmps.youtube.com/live2', key },
    })

    await obs.call('StartStream')
    await sleep(20000) // watch YouTube Studio for incoming video
    const status = await obs.call('GetStreamStatus')
    await obs.call('StopStream')
    await sleep(2000)

    return {
      ok: status.outputActive === true && status.outputReconnecting !== true,
      outputActive: status.outputActive,
      outputReconnecting: status.outputReconnecting,
      outputDuration: status.outputDuration,
      outputBytes: status.outputBytes,
    }
  } finally {
    try { await obs.disconnect() } catch (_) {}
    handle.disconnect()
  }
}
```

- [ ] **Step 3: Run the probe + watch YouTube Studio (BOTH platforms)**

```bash
SPIKE_SCREEN_KIND=monitor_capture SPIKE_YT_KEY=*** npm --prefix spike start -- 05-rtmps                 # Windows
SPIKE_SCREEN_KIND=pipewire-desktop-capture-source SPIKE_YT_KEY=*** npm --prefix spike start -- 05-rtmps  # Linux
```
Expected: `outputActive: true`, `outputReconnecting: false`, `outputBytes` climbing; YouTube Studio shows live video.

- [ ] **Step 4: Evaluate the gate**

- **PASS:** stream goes live end-to-end on at least one platform (proves the whole pipeline), ideally both.
- **CAVEAT:** RTMPS fails but RTMP (`rtmp://a.rtmp.youtube.com/live2`) works → TLS/ingest caveat, not a foundation kill.

- [ ] **Step 5: Record finding + commit (no key!)**

```bash
git add spike/probes/05-rtmps.js spike/FINDINGS.md
git commit -m "spike: end-to-end RTMPS stream to YouTube via OBS sidecar"
```

---

### Task 6: Synthesize findings + go/no-go (including hidden-operation & bundling verdicts)

**Files:**
- Modify: `spike/FINDINGS.md`

**Interfaces:**
- Consumes: all `spike/out/*.json` + accumulated notes.
- Produces: the spike's deliverable — a decision plus the two approach-specific verdicts (hidden operation, bundling).

- [ ] **Step 1: Per-platform results table**

```markdown
| Probe | Linux (Bazzite/Wayland) | Windows |
|-------|--------------------------|---------|
| 00 env / OBS located | <result> | <result> |
| 01 launch + connect  | <PASS/KILL> | <PASS/KILL> |
| 02 create source     | <PASS/KILL> | <PASS/KILL> |
| 02b portal persists  | <yes/no/NA> | NA |
| 03 non-black frames  | <PASS/KILL> | <PASS/KILL> |
| 04 encoder control   | <mechanism> | <mechanism> |
| 05 RTMPS live        | <PASS/CAVEAT> | <PASS/CAVEAT> |
```

- [ ] **Step 2: Answer the approach-specific risks explicitly**

- **Hidden/headless operation:** did `--minimize-to-tray` keep OBS out of the way while still rendering capture? Is there a cleaner offscreen approach? Verdict: acceptable / needs work / blocker.
- **Bundling footprint & acquisition:** OBS install size; on Bazzite did Flatpak OBS cooperate with child-process + localhost control; for Windows is a portable bundle viable. Verdict.
- **Encoder strategy:** confirmed approach (ship GW2 OBS profiles vs socket settings).

- [ ] **Step 3: Write the recommendation**

Exactly one of:
- **GO** — sidecar works on both platforms; OBS hides acceptably; proceed to master-ordering step 1 (real capture→encode→RTMPS slice in the app, talking to OBS).
- **GO WITH CAVEATS** — works with documented constraints (e.g. Wayland portal re-prompts, OBS window can't fully hide, Linux software-encode only). List each + its impact.
- **NO-GO** — a hard gate failed unrecoverably. Document it and list next candidates (embedded OBS build, custom libobs addon, or dropping Linux).

- [ ] **Step 4: Commit the decision**

```bash
git add spike/FINDINGS.md
git commit -m "spike: OBS-sidecar go/no-go findings + recommendation"
```

---

## Self-Review

- **Spec coverage:** capture (Tasks 2–3), hardware/software encode strategy (Task 4), RTMPS-to-YouTube via pasted key (Task 5), cross-platform Linux+Windows (every gate runs on both). Privacy masks, GW2 presets, and the release tail remain later master-ordering steps; Task 4 deliberately surfaces *how* presets will be applied (OBS profiles) so that later step isn't blind.
- **Risk-first ordering:** the new approach's novel risks (hidden operation, Wayland portal persistence, Flatpak cooperation, bundling) are front-loaded — portal persistence is tested inside the hard gate (Task 2), and the frame proof (Task 3) is automated so a Wayland-black failure surfaces objectively.
- **Known soft spots:** exact obs-websocket request fields and Linux PipeWire input-kind ids vary across OBS minor versions — every probe discovers ids via `GetInputKindList`/`GetVersion` rather than asserting them, and the plan flags "confirm against installed protocol version." The `pngLooksNonBlack` heuristic is intentionally crude (entropy proxy); if it gives a false read, swap to decoding the PNG with a tiny library — noted inline.

---

## Sources

- obs-websocket — enabling the server, CLI flags (`--websocket_port`, `--websocket_password`, `--websocket_debug`): https://github.com/obsproject/obs-websocket and https://getvpe.com/resources/blog/obs-websocket-guide
- obs-websocket-js v5 client: https://www.npmjs.com/package/obs-websocket-js
- obs-studio-node platform limitation that triggered this pivot: https://github.com/stream-labs/obs-studio-node

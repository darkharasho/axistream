# Blur-Style Privacy Masks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global mask style — Solid box (existing) or Blur — where blur renders as region-masked `obs_composite_blur` filters on the capture source, with the plugin installable in-app.

**Architecture:** `PluginInstaller` parameterized by flatpak ref (second instance for CompositeBlur); `MaskController.applyMasks(masks, style)` reconciles both representations (color inputs XOR blur filters, no orphans on switch); `maskStyle` persisted; `blurPlugin` status slice mirrors `gameAudioPlugin`; the mask editor toolbar gets a Solid/Blur toggle with the inline install flow. Spec: `docs/superpowers/specs/2026-07-06-blur-masks-design.md` (filter schema is live-probed + source-quoted ground truth).

**Tech Stack:** obs-websocket-js 5 filter API, React 18, Vitest 2.

## Global Constraints

- No new dependencies; 2-space indent, no semicolons, single quotes, named exports, `.js` extensions on relative imports.
- Exact refs: `GAME_AUDIO_PLUGIN_REF = 'com.obsproject.Studio.Plugin.PipeWireAudioCapture'`, `BLUR_PLUGIN_REF = 'com.obsproject.Studio.Plugin.CompositeBlur'`. Blur readiness = `GetSourceFilterKindList` contains the EXACT kind `obs_composite_blur` (no regex).
- Exact filter values: kind `obs_composite_blur` on source `AxiStream Capture`; per-mask settings `{ blur_algorithm: 1, blur_type: 1, radius: 30, effect_mask: 2, effect_mask_rect_center_x: (m.x + m.w / 2) * 100, effect_mask_rect_center_y: (m.y + m.h / 2) * 100, effect_mask_rect_width: m.w * 100, effect_mask_rect_height: m.h * 100 }` (percent coords, NOT pixels). Filter name `BLUR_PREFIX + mask.id`, `BLUR_PREFIX = 'AxiStream Blur '`.
- `maskStyle: 'box' | 'blur'`, default `'box'`. Style switching must leave no orphans: box style sweeps all `BLUR_PREFIX` filters; blur style sweeps all `MASK_PREFIX` color inputs.
- Boot must log exactly `console.info('[blur] filter kinds', kinds)`.
- All OBS calls best-effort; nothing blocks boot/go-live. Everything reuses `relaunchApp` for activation.
- Gates per task: `npm -w @axistream/app run test`; Tasks 5–6 also `cd packages/app && npx tsc --noEmit -p tsconfig.json` at zero (Tasks 1–4 stage red into `src/main/index.ts` / editor components — record the set each task).

---

## File Structure

**Modified only:** `src/main/PluginInstaller.ts` (T1), `src/main/StreamSettings.ts` (T2), `src/main/MaskController.ts` (T3), `src/shared/state.ts` + `src/main/ipc.ts` + `src/preload/index.ts` (T4), `src/main/index.ts` (T5), `src/renderer/components/MaskEditor.tsx` + `StreamScreen.tsx` + `styles.css` (T6); tests alongside.

---

### Task 1: PluginInstaller — ref parameterization + deriveBlurStatus

**Files:**
- Modify: `packages/app/src/main/PluginInstaller.ts`
- Test: `packages/app/test/plugin-installer.test.ts` (extend/adjust)

**Interfaces:**
- Produces: `InstallerDeps` gains `ref: string` (required); `PLUGIN_REF` renamed to `GAME_AUDIO_PLUGIN_REF`; new `BLUR_PLUGIN_REF = 'com.obsproject.Studio.Plugin.CompositeBlur'`; new `deriveBlurStatus(flatpak: FlatpakState, filterKinds: string[]): GameAudioPluginStatus` (ready = includes `'obs_composite_blur'`); `detectInstalled`/`install` use `this.d.ref` in every argv.

- [ ] **Step 1: Adjust/extend the failing tests.** In `plugin-installer.test.ts`: rename the `PLUGIN_REF` import to `GAME_AUDIO_PLUGIN_REF` and add `BLUR_PLUGIN_REF, deriveBlurStatus`; thread `ref` into the `fakeExec` constructions (existing tests use `GAME_AUDIO_PLUGIN_REF`); append:

```ts
describe('ref parameterization', () => {
  it('detect and install use the constructor ref', async () => {
    const f = fakeExec(() => ({ code: 0, output: 'ok' }))
    const inst = new PluginInstaller({ ...f, ref: BLUR_PLUGIN_REF })
    await inst.detectInstalled()
    expect(f.calls[0].args).toEqual(['info', BLUR_PLUGIN_REF])
    await inst.install()
    expect(f.calls[1].args).toEqual(['install', '--user', '--noninteractive', 'flathub', BLUR_PLUGIN_REF])
  })
})

describe('deriveBlurStatus', () => {
  const K = ['mask_filter', 'obs_composite_blur', 'crop_filter']
  it('unsupported → unsupported', () => { expect(deriveBlurStatus('unsupported', K)).toBe('unsupported') })
  it('missing → missing', () => { expect(deriveBlurStatus('missing', K)).toBe('missing') })
  it('installed + kind present → ready', () => { expect(deriveBlurStatus('installed', K)).toBe('ready') })
  it('installed + kind absent → installed', () => { expect(deriveBlurStatus('installed', ['mask_filter'])).toBe('installed') })
  it('exact-match only (no substring/regex)', () => {
    expect(deriveBlurStatus('installed', ['obs_composite_blur_v2_not_real'])).toBe('installed')
  })
})
```

(Adapt the `fakeExec` helper so its return spreads into deps: `new PluginInstaller({ exec: f.exec, ref: ... })` — match the file's existing helper shape.)
- [ ] **Step 2: Run to verify failure** — `npm -w @axistream/app run test -- test/plugin-installer.test.ts` → FAIL (ref not accepted / exports missing)
- [ ] **Step 3: Implement.** In `PluginInstaller.ts`:

```ts
export const GAME_AUDIO_PLUGIN_REF = 'com.obsproject.Studio.Plugin.PipeWireAudioCapture'
export const BLUR_PLUGIN_REF = 'com.obsproject.Studio.Plugin.CompositeBlur'
```

`InstallerDeps` gains `ref: string`; `detectInstalled` uses `['info', this.d.ref]`; `install` uses `['install', scope, '--noninteractive', 'flathub', this.d.ref]`. Add:

```ts
/** Blur-plugin readiness: the CompositeBlur filter kind is an exact id —
 *  no regex needed (unlike the audio plugin's several kinds). */
export function deriveBlurStatus(flatpak: FlatpakState, filterKinds: string[]): GameAudioPluginStatus {
  if (flatpak === 'unsupported') return 'unsupported'
  if (flatpak === 'missing') return 'missing'
  return filterKinds.includes('obs_composite_blur') ? 'ready' : 'installed'
}
```

- [ ] **Step 4: Run to verify pass** — installer tests green; full suite green (nothing else imports `PLUGIN_REF`; `index.ts` constructs `new PluginInstaller({ exec })` without `ref` → tsc red there only — the staged gap; note it).
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/PluginInstaller.ts packages/app/test/plugin-installer.test.ts
git commit -m "feat(plugins): ref-parameterized installer + blur readiness derivation"
```

---

### Task 2: StreamSettings.maskStyle

**Files:**
- Modify: `packages/app/src/main/StreamSettings.ts`
- Test: `packages/app/test/stream-settings.test.ts` (append)

**Interfaces:**
- Produces: `StreamSettingsData.maskStyle: 'box' | 'blur'`, default `'box'`, enum-validated in `load()` (mirror the `privacy` enum pattern: `const MASK_STYLES: Array<'box' | 'blur'> = ['box', 'blur']`).

- [ ] **Step 1: Failing tests** (append, reusing the file's temp-path pattern):

```ts
describe('maskStyle', () => {
  it('defaults to box and round-trips blur', () => {
    const s = new StreamSettings(file)
    expect(s.load().maskStyle).toBe('box')
    s.patch({ maskStyle: 'blur' })
    expect(s.load().maskStyle).toBe('blur')
  })
  it('invalid value falls back to box', () => {
    writeFileSync(file, JSON.stringify({ maskStyle: 'plaid' }))
    expect(new StreamSettings(file).load().maskStyle).toBe('box')
  })
})
```

- [ ] **Step 2:** `npm -w @axistream/app run test -- test/stream-settings.test.ts` → FAIL
- [ ] **Step 3: Implement** — type union on the interface, `maskStyle: 'box'` in `DEFAULT_SETTINGS`, `maskStyle: MASK_STYLES.includes(raw.maskStyle as 'box' | 'blur') ? (raw.maskStyle as 'box' | 'blur') : 'box',` in `load()`.
- [ ] **Step 4:** stream-settings green; full suite green.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/StreamSettings.ts packages/app/test/stream-settings.test.ts
git commit -m "feat(settings): persist mask style (box | blur)"
```

---

### Task 3: MaskController — style-aware reconcile

**Files:**
- Modify: `packages/app/src/main/MaskController.ts`
- Test: `packages/app/test/mask-controller.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new from other tasks (style arrives as a plain parameter).
- Produces: `applyMasks(masks: MaskRect[], style: 'box' | 'blur'): Promise<void>` (parameter REQUIRED — callers updated in Task 5); `export const BLUR_PREFIX = 'AxiStream Blur '`; capture source constant `const CAPTURE = 'AxiStream Capture'` (module-private).

- [ ] **Step 1: Failing tests.** Update the recorder so `GetSourceFilterList` returns `{ filters: (opts.filters ?? []).map((filterName) => ({ filterName })) }`. Update ALL existing `applyMasks(...)` calls to pass `'box'` as the second argument (behavior regression-tested unchanged). Append:

```ts
describe('MaskController blur style', () => {
  const m = (id: string, x = 0.25, y = 0.5, w = 0.1, h = 0.2): MaskRect => ({ id, x, y, w, h })
  const BLUR_SETTINGS = {
    blur_algorithm: 1, blur_type: 1, radius: 30, effect_mask: 2,
    effect_mask_rect_center_x: 30, effect_mask_rect_center_y: 60,
    effect_mask_rect_width: 10, effect_mask_rect_height: 20,
  }

  it('creates a composite-blur filter per mask with exact percent settings', async () => {
    const r = recorder()
    await new MaskController({ client: r.client }).applyMasks([m('a')], 'blur')
    const create = r.calls.find((c) => c.req === 'CreateSourceFilter')
    expect(create?.data).toEqual({
      sourceName: 'AxiStream Capture', filterName: `${BLUR_PREFIX}a`,
      filterKind: 'obs_composite_blur', filterSettings: BLUR_SETTINGS,
    })
  })

  it('updates an existing blur filter instead of recreating', async () => {
    const r = recorder({ filters: [`${BLUR_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([m('a')], 'blur')
    expect(r.calls.some((c) => c.req === 'CreateSourceFilter')).toBe(false)
    expect(r.calls.find((c) => c.req === 'SetSourceFilterSettings')?.data).toEqual({
      sourceName: 'AxiStream Capture', filterName: `${BLUR_PREFIX}a`, filterSettings: BLUR_SETTINGS, overlay: true,
    })
  })

  it('removes stale blur filters, leaves non-AxiStream filters alone', async () => {
    const r = recorder({ filters: [`${BLUR_PREFIX}old`, 'User Sharpen'] })
    await new MaskController({ client: r.client }).applyMasks([], 'blur')
    const removed = r.calls.filter((c) => c.req === 'RemoveSourceFilter').map((c) => c.data.filterName)
    expect(removed).toEqual([`${BLUR_PREFIX}old`])
  })

  it('blur style sweeps mask color inputs (style switch box→blur)', async () => {
    const r = recorder({ inputs: [`${MASK_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([m('a')], 'blur')
    expect(r.calls.find((c) => c.req === 'RemoveInput')?.data).toEqual({ inputName: `${MASK_PREFIX}a` })
    expect(r.calls.some((c) => c.req === 'CreateSourceFilter')).toBe(true)
  })

  it('box style sweeps blur filters (style switch blur→box)', async () => {
    const r = recorder({ filters: [`${BLUR_PREFIX}a`] })
    await new MaskController({ client: r.client }).applyMasks([m('a')], 'box')
    expect(r.calls.filter((c) => c.req === 'RemoveSourceFilter').map((c) => c.data.filterName)).toEqual([`${BLUR_PREFIX}a`])
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(true)
  })

  it('throwing client swallowed in blur mode', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    await expect(new MaskController({ client }).applyMasks([m('a')], 'blur')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2:** `npm -w @axistream/app run test -- test/mask-controller.test.ts` → FAIL
- [ ] **Step 3: Implement.** In `MaskController.ts` add:

```ts
export const BLUR_PREFIX = 'AxiStream Blur '
const CAPTURE = 'AxiStream Capture'
const BLUR_KIND = 'obs_composite_blur'

function blurSettingsFor(m: MaskRect) {
  // CompositeBlur's rectangle effect-mask takes PERCENTAGES of the source.
  return {
    blur_algorithm: 1, blur_type: 1, radius: 30, effect_mask: 2,
    effect_mask_rect_center_x: (m.x + m.w / 2) * 100,
    effect_mask_rect_center_y: (m.y + m.h / 2) * 100,
    effect_mask_rect_width: m.w * 100,
    effect_mask_rect_height: m.h * 100,
  }
}
```

Restructure `applyMasks(masks, style)`:

```ts
  async applyMasks(masks: MaskRect[], style: 'box' | 'blur'): Promise<void> {
    try {
      const c = this.d.client()
      const capped = masks.slice(0, MAX_MASKS)
      if (style === 'blur') {
        await this.removeAllMaskInputs(c)
        await this.reconcileBlurFilters(c, capped)
      } else {
        await this.removeAllBlurFilters(c)
        await this.reconcileBoxInputs(c, capped) // existing body, extracted
      }
    } catch (e) { console.warn('[masks] applyMasks failed', e) }
  }
```

- `reconcileBoxInputs(c, masks)` = the existing body verbatim (GetVideoSettings guard, GetInputList, remove stale `MASK_PREFIX` inputs not in list, create/update + scene-item recovery + transform).
- `removeAllMaskInputs(c)`: `GetInputList` → `RemoveInput` (each `.catch(() => {})`) for every `MASK_PREFIX` input.
- `reconcileBlurFilters(c, masks)`: `GetSourceFilterList { sourceName: CAPTURE }` → remove `BLUR_PREFIX` filters not wanted (`RemoveSourceFilter { sourceName: CAPTURE, filterName }`, each `.catch(() => {})`) → per mask: exists ? `SetSourceFilterSettings { sourceName: CAPTURE, filterName, filterSettings: blurSettingsFor(m), overlay: true }` : `CreateSourceFilter { sourceName: CAPTURE, filterName, filterKind: BLUR_KIND, filterSettings: blurSettingsFor(m) }`.
- `removeAllBlurFilters(c)`: `GetSourceFilterList` → remove every `BLUR_PREFIX` filter.
- Note the blur path needs NO GetVideoSettings (percent coords); keep the canvas guard inside `reconcileBoxInputs` only.
- [ ] **Step 4:** mask-controller green; full suite green (typecheck now red in `index.ts` for the new required parameter AND the missing installer ref — staged; note the set).
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/MaskController.ts packages/app/test/mask-controller.test.ts
git commit -m "feat(masks): style-aware reconcile — blur filters XOR color inputs"
```

---

### Task 4: Shared state + IPC + preload

**Files:**
- Modify: `packages/app/src/shared/state.ts`, `packages/app/src/main/ipc.ts`, `packages/app/src/preload/index.ts`
- Test: `packages/app/test/ipc-contract.test.ts` (append)

**Interfaces:**
- Produces: `AppState.blurPlugin: GameAudioPluginView` (INITIAL `{ status: 'missing', error: null }`); `AppState.maskStyle: 'box' | 'blur'` (INITIAL `'box'`); `CH.setMaskStyle = 'axi:setMaskStyle'`, `CH.installBlurPlugin = 'axi:installBlurPlugin'`; `AxiApi`/`IpcHandlers`: `setMaskStyle(style: 'box' | 'blur'): Promise<void>`, `installBlurPlugin(): Promise<void>`.

- [ ] **Step 1: Failing test** — add both channels to `commandChannels` + `vi.fn()` stubs in the mock.
- [ ] **Step 2:** ipc-contract FAIL.
- [ ] **Step 3: Implement** the fields/channels/methods across the three files, mirroring the gameAudioPlugin siblings exactly (`ipcMain.handle(CH.setMaskStyle, (_e: unknown, style: 'box' | 'blur') => handlers.setMaskStyle(style))`, `ipcMain.handle(CH.installBlurPlugin, () => handlers.installBlurPlugin())`).
- [ ] **Step 4:** ipc-contract green; full suite green (fixtures hand-building AppState need `blurPlugin: { status: 'missing', error: null }, maskStyle: 'box'` — the compiler names them; include those files). Typecheck red set unchanged plus preload closed — record it.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/state.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/app/test/ipc-contract.test.ts
git commit -m "feat(state): blurPlugin + maskStyle channels"
```

(Include fixture files touched.)

---

### Task 5: Main wiring

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Test: suites + typecheck (seams tested in Tasks 1–4)

**Interfaces:**
- Consumes: `GAME_AUDIO_PLUGIN_REF`/`BLUR_PLUGIN_REF`/`deriveBlurStatus` (T1), `maskStyle` setting (T2), `applyMasks(masks, style)` (T3), handlers (T4).

- [ ] **Step 1: Wire it.**
  - Extract the existing execFile adapter into `const flatpakExec = (cmd, args, timeoutMs) => new Promise(...)` (the current inline body, unchanged) and construct BOTH installers:

```ts
  const installer = new PluginInstaller({ exec: flatpakExec, ref: GAME_AUDIO_PLUGIN_REF })
  const blurInstaller = new PluginInstaller({ exec: flatpakExec, ref: BLUR_PLUGIN_REF })
```

  - `installBlurPlugin` handler: mirror `installGameAudioPlugin` verbatim but on `blurInstaller` + `state.blurPlugin` + `setState({ blurPlugin: ... })`.
  - `setMaskStyle` handler:

```ts
    setMaskStyle: async (style: 'box' | 'blur') => {
      settings.patch({ maskStyle: style })
      await maskCtl.applyMasks(settings.load().masks, style)
      setState({ maskStyle: style })
    },
```

  - EVERY existing `maskCtl.applyMasks(...)` call site (setMasks handler, boot, provision, repairCapture, switchSource) gains the style argument from the settings object already in hand (`settings.load().maskStyle` or the loaded `a.maskStyle`).
  - Boot (provisioned branch): after the `[game-audio] input kinds` probe block, add the blur probe:

```ts
      let filterKinds: string[] = []
      try { filterKinds = ((await sidecar.client().call('GetSourceFilterKindList')) as { sourceFilterKinds?: string[] }).sourceFilterKinds ?? [] } catch { /* best-effort */ }
      console.info('[blur] filter kinds', filterKinds)
      setState({ blurPlugin: { status: deriveBlurStatus(await blurInstaller.detectInstalled(), filterKinds), error: null }, maskStyle: a.maskStyle })
```

  - Unprovisioned branch: flatpak-only probe mirroring the audio one: `setState({ blurPlugin: { status: deriveBlurStatus(await blurInstaller.detectInstalled(), []), error: null }, maskStyle: settings.load().maskStyle })`.
- [ ] **Step 2: Typecheck** — expected at ZERO errors after this task (the renderer components don't reference the new fields until Task 6). Verify and record; if anything is still red, name it in your report.
- [ ] **Step 3: Full suite** — green.
- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(main): blur installer + mask-style wiring and boot probe"
```

---

### Task 6: UI — style toggle in the mask editor

**Files:**
- Modify: `packages/app/src/renderer/components/MaskEditor.tsx`, `packages/app/src/renderer/components/StreamScreen.tsx`, `packages/app/src/renderer/styles.css`
- Test: `packages/app/test/mask-editor.test.tsx` (extend), `stream-screen.test.tsx` (mock additions if flagged)

**Interfaces:**
- Consumes: `AppState.maskStyle`/`blurPlugin` via StreamScreen; `axi.setMaskStyle`/`installBlurPlugin`/`relaunchApp` (T4/T5).
- Produces: `MaskEditor` props gain `maskStyle: 'box' | 'blur'`, `blurPlugin: AppState['gameAudioPlugin']` (same view type), `onSetStyle(style)`, `onInstallBlur()`, `onRelaunch()`.

- [ ] **Step 1: Failing tests** — append to `mask-editor.test.tsx` (extend the existing render helpers; all existing renders gain the new props with defaults `maskStyle="box" blurPlugin={{ status: 'ready', error: null }} onSetStyle={vi.fn()} onInstallBlur={vi.fn()} onRelaunch={vi.fn()}`):

```tsx
describe('MaskEditor style toggle', () => {
  const ready = { status: 'ready' as const, error: null }
  const props = (over: Record<string, unknown> = {}) => ({
    masks: [], onCommit: () => {}, onDone: () => {},
    maskStyle: 'box' as const, blurPlugin: ready,
    onSetStyle: vi.fn(), onInstallBlur: vi.fn(), onRelaunch: vi.fn(), ...over,
  })

  it('renders Solid and Blur options with the current style active', () => {
    const p = props()
    render(<MaskEditor {...p} />)
    expect(screen.getByText('Solid').className).toContain('on')
    expect(screen.getByText('Blur').className).not.toContain('on')
  })

  it('selecting Blur when the plugin is ready sets the style', () => {
    const p = props()
    render(<MaskEditor {...p} />)
    fireEvent.click(screen.getByText('Blur'))
    expect(p.onSetStyle).toHaveBeenCalledWith('blur')
  })

  it('selecting Blur when the plugin is missing shows the install prompt instead', () => {
    const p = props({ blurPlugin: { status: 'missing', error: null } })
    render(<MaskEditor {...p} />)
    fireEvent.click(screen.getByText('Blur'))
    expect(p.onSetStyle).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Install blur plugin'))
    expect(p.onInstallBlur).toHaveBeenCalled()
  })

  it('installed status offers Restart AxiStream', () => {
    const p = props({ blurPlugin: { status: 'installed', error: null } })
    render(<MaskEditor {...p} />)
    fireEvent.click(screen.getByText('Blur'))
    fireEvent.click(screen.getByText('Restart AxiStream'))
    expect(p.onRelaunch).toHaveBeenCalled()
  })

  it('selecting Solid always works', () => {
    const p = props({ maskStyle: 'blur' as const })
    render(<MaskEditor {...p} />)
    fireEvent.click(screen.getByText('Solid'))
    expect(p.onSetStyle).toHaveBeenCalledWith('box')
  })
})
```

- [ ] **Step 2:** mask-editor tests FAIL (props unknown).
- [ ] **Step 3: Implement.**

`MaskEditor.tsx` — extend props; add local `const [blurPrompt, setBlurPrompt] = useState(false)`; in the toolbar between "Add mask" and the hint:

```tsx
      <div className="mask-style" role="group" aria-label="Mask style">
        <button className={`mask-style-btn${maskStyle === 'box' ? ' on' : ''}`} onClick={() => { setBlurPrompt(false); onSetStyle('box') }}>Solid</button>
        <button className={`mask-style-btn${maskStyle === 'blur' ? ' on' : ''}`}
          onClick={() => { if (blurPlugin.status === 'ready') { setBlurPrompt(false); onSetStyle('blur') } else setBlurPrompt(true) }}>Blur</button>
      </div>
```

And below the toolbar, when `blurPrompt && blurPlugin.status !== 'ready'`, an inline prompt pill:

```tsx
      {blurPrompt && blurPlugin.status !== 'ready' && (
        <div className="mask-blur-prompt">
          {blurPlugin.status === 'missing' && <button className="btn ghost xs" onClick={onInstallBlur}>Install blur plugin</button>}
          {blurPlugin.status === 'installing' && <span>Installing…</span>}
          {blurPlugin.status === 'installed' && <button className="btn ghost xs" onClick={onRelaunch}>Restart AxiStream</button>}
          {blurPlugin.status === 'error' && <button className="btn ghost xs" onClick={onInstallBlur}>Retry install</button>}
          {blurPlugin.status === 'unsupported' && <span>Blur needs the OBS flatpak.</span>}
        </div>
      )}
```

`StreamScreen.tsx` — thread the props:

```tsx
        <MaskEditor masks={state.masks} maskStyle={state.maskStyle} blurPlugin={state.blurPlugin}
          onSetStyle={(s) => axi.setMaskStyle(s)} onInstallBlur={() => axi.installBlurPlugin()}
          onRelaunch={() => axi.relaunchApp()}
          onCommit={(m) => axi.setMasks(m)} onDone={() => setEditingMasks(false)} />
```

`styles.css` — append:

```css
/* Mask style segmented toggle + inline blur-plugin prompt. */
.mask-style { display: flex; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; overflow: hidden; }
.mask-style-btn { background: none; border: none; color: #8b95a5; font-size: 11px; font-weight: 600; padding: 4px 10px; cursor: pointer; }
.mask-style-btn.on { background: rgba(34,211,238,.15); color: #bfeef7; }
.mask-blur-prompt { position: absolute; top: 88px; left: 50%; transform: translateX(-50%); z-index: 6; display: flex; align-items: center; gap: 8px;
  background: rgba(13,15,20,.85); border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 6px 10px; font-size: 12px; color: #c4cedb; }
```

- [ ] **Step 4: Run everything** — targeted + full suite green; typecheck zero.
- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/MaskEditor.tsx packages/app/src/renderer/components/StreamScreen.tsx packages/app/src/renderer/styles.css packages/app/test/mask-editor.test.tsx
git commit -m "feat(ui): Solid/Blur mask-style toggle with inline plugin install"
```

(Include `stream-screen.test.tsx` if its mock needed the new axi stubs.)

---

## Final verification (whole branch)

- Full suite green; typecheck zero.
- Manual smoke (human): mask over chat → toggle Blur → preview shows blurred region; toggle back to Solid → black box, no leftovers; boot log shows `[blur] filter kinds` including `obs_composite_blur` (the extension is already installed on this machine from the spike).

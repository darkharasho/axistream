import { callReady } from './call-ready.js'
import { isNonBlackPng } from './frame-check.js'
import { CaptureConfig, type CaptureTarget, type ProvisionStatus } from './capture-config.js'
import { ensureAudioInputs } from './audio-inputs.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const COLLECTION = 'AxiStream'
const SCRATCH = 'AxiStreamScratch'
const SCENE = 'Main'
const CAPTURE = 'AxiStream Capture'
const WAYLAND_KIND = 'pipewire-screen-capture-source'
const WINDOWS_KIND = 'monitor_capture'

export interface ProvisionerSidecar {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client(): { call: (...args: any[]) => Promise<any> }
  restart(): Promise<void>
}

export interface ProvisionerDeps {
  sidecar: ProvisionerSidecar
  config: CaptureConfig
  platform: NodeJS.Platform
  screenKind?: string
  // bounded poll for the post-reload frame; small in tests
  approvalPollTries?: number
  approvalPollDelayMs?: number
}

export type ProvisionResult =
  | { ok: true; status: 'READY' }
  | { ok: false; status: 'AWAITING_APPROVAL' }
  | { ok: false; status: 'CHOOSING_TARGET'; targets: CaptureTarget[] }

export class Provisioner {
  private state: ProvisionStatus
  constructor(private readonly deps: ProvisionerDeps) {
    this.state = deps.config.isProvisioned() ? 'READY' : 'UNPROVISIONED'
  }

  status(): ProvisionStatus { return this.state }

  async repair(onApprovalNeeded?: () => void, target?: CaptureTarget): Promise<ProvisionResult> {
    this.state = 'REPAIR'
    return this.provision(onApprovalNeeded, target)
  }

  async provision(onApprovalNeeded?: () => void, selectedTarget?: CaptureTarget): Promise<ProvisionResult> {
    this.state = 'BUILDING'
    const c = () => this.deps.sidecar.client()
    const isWayland = this.deps.platform === 'linux'
    const kind = this.deps.screenKind ?? (isWayland ? WAYLAND_KIND : WINDOWS_KIND)

    // Build the collection structure over the socket.
    await this.buildCollection(c(), kind)

    let captureTarget: CaptureTarget | undefined
    if (this.deps.platform === 'win32') {
      const targets = await this.listWindowsTargets(c())
      const requested = selectedTarget ?? this.deps.config.load().target
      if (requested) {
        captureTarget = targets.find((target) =>
          target.property === requested.property &&
          target.value === requested.value,
        )
        if (!captureTarget) throw new Error('The selected display is no longer available')
      } else if (targets.length === 1) {
        captureTarget = targets[0]
      } else {
        this.state = 'CHOOSING_TARGET'
        return { ok: false, status: 'CHOOSING_TARGET', targets }
      }
      if (!captureTarget) throw new Error('No display was selected')
      const target = captureTarget
      await callReady(() => c().call('SetInputSettings', {
        inputName: CAPTURE,
        inputSettings: { [target.property]: target.value },
        overlay: true,
      }))
    }

    if (isWayland) {
      // Persist by switching collections (forces OBS to save), then reload.
      await callReady(() => c().call('CreateSceneCollection', { sceneCollectionName: SCRATCH })).catch(() => {})
      await callReady(() => c().call('SetCurrentSceneCollection', { sceneCollectionName: SCRATCH }))
      await callReady(() => c().call('GetSceneList'))
      await this.deps.sidecar.restart()
      this.state = 'AWAITING_APPROVAL'
      onApprovalNeeded?.()
    }

    // Poll for a real (non-black) frame.
    const ok = await this.waitForFrame(() => this.deps.sidecar.client())
    if (ok) {
      if (isWayland) {
        // Force-persist the AxiStream collection (which now holds the runtime restore token)
        // by switching to SCRATCH — this triggers OBS to flush the collection to disk so the
        // token survives a SIGKILL teardown — then switch BACK to AxiStream. Without the switch
        // back, OBS is left on the empty SCRATCH collection, so the program (and the virtual-cam
        // preview) render black until the next launch reloads AxiStream.
        await callReady(() => c().call('SetCurrentSceneCollection', { sceneCollectionName: SCRATCH }))
        await callReady(() => c().call('SetCurrentSceneCollection', { sceneCollectionName: COLLECTION }))
      }
      this.deps.config.save({
        ...this.deps.config.load(),
        provisioned: true,
        platform: this.deps.platform,
        ...(captureTarget ? { target: captureTarget } : {}),
        collection: COLLECTION,
      })
      this.state = 'READY'
      return { ok: true, status: 'READY' }
    }
    if (this.deps.platform === 'win32') {
      throw new Error('The selected display did not produce a visible frame before setup timed out')
    }
    this.state = 'AWAITING_APPROVAL'
    return { ok: false, status: 'AWAITING_APPROVAL' }
  }

  private async listWindowsTargets(client: ReturnType<ProvisionerSidecar['client']>): Promise<CaptureTarget[]> {
    let property = 'monitor_id'
    let response: { propertyItems?: unknown[] }
    try {
      response = await client.call('GetInputPropertiesListPropertyItems', {
        inputName: CAPTURE, propertyName: property,
      })
      if (!Array.isArray(response.propertyItems)) throw new Error('monitor_id property is unavailable')
    } catch {
      property = 'monitor'
      response = await client.call('GetInputPropertiesListPropertyItems', {
        inputName: CAPTURE, propertyName: property,
      })
      if (!Array.isArray(response.propertyItems)) throw new Error('OBS does not expose a display capture property')
    }
    const targets = response.propertyItems.flatMap((value): CaptureTarget[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      if (item['itemEnabled'] === false) return []
      if (typeof item['itemName'] !== 'string') return []
      if (typeof item['itemValue'] !== 'string' && typeof item['itemValue'] !== 'number') return []
      return [{ property, value: item['itemValue'], label: item['itemName'] }]
    })
    if (targets.length === 0) throw new Error('No usable displays were reported by OBS')
    return targets
  }

  private async buildCollection(client: ReturnType<ProvisionerSidecar['client']>, kind: string): Promise<void> {
    const { currentSceneCollectionName, sceneCollections } =
      await callReady(() => client.call('GetSceneCollectionList'))
    if (!sceneCollections.includes(COLLECTION)) {
      await callReady(() => client.call('CreateSceneCollection', { sceneCollectionName: COLLECTION }))
      await callReady(() => client.call('GetSceneList'))
    } else if (currentSceneCollectionName !== COLLECTION) {
      await callReady(() => client.call('SetCurrentSceneCollection', { sceneCollectionName: COLLECTION }))
      await callReady(() => client.call('GetSceneList'))
    }
    // Clean any prior spike/capture leftovers.
    try {
      const { inputs } = await client.call('GetInputList')
      for (const inp of inputs ?? []) {
        if (inp.inputName === CAPTURE) await client.call('RemoveInput', { inputName: CAPTURE }).catch(() => {})
      }
    } catch { /* ignore */ }
    await callReady(() => client.call('RemoveScene', { sceneName: SCENE })).catch(() => {})
    await callReady(() => client.call('CreateScene', { sceneName: SCENE }))
    await callReady(() => client.call('SetCurrentProgramScene', { sceneName: SCENE }))
    await callReady(() => client.call('CreateInput', {
      sceneName: SCENE, inputName: CAPTURE, inputKind: kind, inputSettings: {},
    }))
    await ensureAudioInputs(client)
  }

  private async waitForFrame(client: () => ReturnType<ProvisionerSidecar['client']>): Promise<boolean> {
    const tries = this.deps.approvalPollTries ?? 40
    const delay = this.deps.approvalPollDelayMs ?? 1500
    for (let i = 0; i < tries; i++) {
      try {
        const shot = await client().call('GetSourceScreenshot', {
          sourceName: CAPTURE, imageFormat: 'png', imageWidth: 640,
        })
        const b64 = String(shot.imageData ?? '').split(',')[1] ?? ''
        if (isNonBlackPng(Buffer.from(b64, 'base64'))) return true
      } catch { /* not ready / not rendered yet */ }
      await sleep(delay)
    }
    return false
  }
}

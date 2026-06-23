import { callReady } from './call-ready.js'
import { isNonBlackPng } from './frame-check.js'
import { CaptureConfig, type ProvisionStatus } from './capture-config.js'

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

export interface ProvisionResult { ok: boolean; status: ProvisionStatus }

export class Provisioner {
  private state: ProvisionStatus
  constructor(private readonly deps: ProvisionerDeps) {
    this.state = deps.config.isProvisioned() ? 'READY' : 'UNPROVISIONED'
  }

  status(): ProvisionStatus { return this.state }

  async repair(onApprovalNeeded?: () => void): Promise<ProvisionResult> {
    this.state = 'REPAIR'
    return this.provision(onApprovalNeeded)
  }

  async provision(onApprovalNeeded?: () => void): Promise<ProvisionResult> {
    this.state = 'BUILDING'
    const c = () => this.deps.sidecar.client()
    const isWayland = this.deps.platform === 'linux'
    const kind = this.deps.screenKind ?? (isWayland ? WAYLAND_KIND : WINDOWS_KIND)

    // Build the collection structure over the socket.
    await this.buildCollection(c(), kind)

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
        // by switching to SCRATCH — this triggers OBS to flush the collection to disk before
        // the sidecar is killed, so the token survives a SIGKILL teardown.
        await callReady(() => c().call('SetCurrentSceneCollection', { sceneCollectionName: SCRATCH }))
      }
      this.deps.config.save({ provisioned: true, platform: this.deps.platform, collection: COLLECTION })
      this.state = 'READY'
      return { ok: true, status: 'READY' }
    }
    this.state = 'AWAITING_APPROVAL'
    return { ok: false, status: 'AWAITING_APPROVAL' }
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

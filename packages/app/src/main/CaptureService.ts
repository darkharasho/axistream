import type { CaptureTarget, ProvisionResult } from '@axistream/capture'

type Phase =
  | 'READY' | 'AWAITING_APPROVAL' | 'SETTING_UP' | 'PREPARING_CAPTURE'
  | 'CHOOSING_CAPTURE' | 'ERROR'

interface ServiceProvisioner {
  status(): string
  provision(cb?: () => void, target?: CaptureTarget): Promise<ProvisionResult>
  repair(cb?: () => void, target?: CaptureTarget): Promise<ProvisionResult>
}

export interface CaptureServiceDeps {
  sidecar: {
    start(): Promise<void>; client(): any; restart(): Promise<void>; stop(): Promise<void>
    on(e: 'crashed', cb: () => void): void
  }
  makeProvisioner(): ServiceProvisioner
  onApprovalNeeded(): void
  onTargets(targets: CaptureTarget[]): void
  onPhase(phase: Phase, error?: string): void
  onCrashed(): void
}

export class CaptureService {
  private provisioner?: ServiceProvisioner
  private started = false
  private crashListenerRegistered = false
  private action?: Promise<boolean>
  private targets: CaptureTarget[] = []

  constructor(private readonly deps: CaptureServiceDeps) {}

  client() { return this.deps.sidecar.client() }

  async start(): Promise<void> {
    if (this.started) return
    this.deps.onPhase('PREPARING_CAPTURE')
    await this.deps.sidecar.start()
    this.provisioner = this.deps.makeProvisioner()
    this.started = true
    if (!this.crashListenerRegistered) {
      this.crashListenerRegistered = true
      this.deps.sidecar.on('crashed', () => {
        this.started = false
        this.deps.onCrashed()
      })
    }
  }

  status(): string { return this.provisioner?.status() ?? 'UNPROVISIONED' }

  captureTargets(): CaptureTarget[] { return [...this.targets] }

  cancelSelection(): void {
    this.publishTargets([])
    this.deps.onPhase('SETTING_UP')
  }

  provision(target?: CaptureTarget): Promise<boolean> {
    return this.begin((provisioner) => provisioner.provision(
      () => this.deps.onApprovalNeeded(), target,
    ))
  }

  repair(target?: CaptureTarget): Promise<boolean> {
    return this.begin((provisioner) => provisioner.repair(
      () => this.deps.onApprovalNeeded(), target,
    ))
  }

  private async begin(operation: (provisioner: ServiceProvisioner) => Promise<ProvisionResult>): Promise<boolean> {
    if (this.action) throw new Error('Capture setup is already in progress')
    const action = this.perform(operation)
    this.action = action
    try { return await action } finally { this.action = undefined }
  }

  private async perform(operation: (provisioner: ServiceProvisioner) => Promise<ProvisionResult>): Promise<boolean> {
    this.deps.onPhase('PREPARING_CAPTURE')
    try {
      if (!this.started) await this.start()
      const provisioner = this.provisioner
      if (!provisioner) throw new Error('Capture engine did not initialize')
      const result = await operation(provisioner)
      if (result.ok) {
        this.publishTargets([])
        this.deps.onPhase('READY')
        return true
      }
      if (result.status === 'CHOOSING_TARGET') {
        this.publishTargets(result.targets)
        this.deps.onPhase('CHOOSING_CAPTURE')
        return false
      }
      this.deps.onPhase('AWAITING_APPROVAL')
      return false
    } catch (error) {
      this.started = false
      try { await this.deps.sidecar.stop() } catch { /* preserve the original setup error */ }
      this.publishTargets([])
      this.deps.onPhase('ERROR', error instanceof Error ? error.message : String(error))
      return false
    }
  }

  private publishTargets(targets: CaptureTarget[]): void {
    this.targets = [...targets]
    this.deps.onTargets(this.captureTargets())
  }
}

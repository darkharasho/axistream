type Phase = 'READY' | 'AWAITING_APPROVAL' | 'SETTING_UP' | 'ERROR'
export interface CaptureServiceDeps {
  sidecar: {
    start(): Promise<void>; client(): any; restart(): Promise<void>; stop(): Promise<void>
    on(e: 'crashed', cb: () => void): void
  }
  makeProvisioner(): { status(): string; provision(cb?: () => void): Promise<{ ok: boolean; status: string }>; repair(cb?: () => void): Promise<{ ok: boolean; status: string }> }
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

  async repair(): Promise<boolean> {
    const res = await this.provisioner.repair(() => this.d.onApprovalNeeded())
    if (res.ok) { this.d.onPhase('READY'); return true }
    this.d.onPhase('SETTING_UP')
    return false
  }
}

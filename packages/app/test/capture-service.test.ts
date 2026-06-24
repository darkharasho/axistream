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

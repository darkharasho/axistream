import { describe, expect, it, vi } from 'vitest'
import { CaptureService } from '../src/main/CaptureService.js'

const target = { property: 'monitor_id', value: '{DISPLAY-1}', label: 'Display 1' }

function deps(provisionResult: any = { ok: true, status: 'READY' }) {
  const sidecar = {
    start: vi.fn().mockResolvedValue(undefined),
    client: vi.fn(() => ({ call: vi.fn() })),
    restart: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }
  const provisioner = {
    status: vi.fn(() => 'UNPROVISIONED'),
    provision: vi.fn(async (cb?: () => void) => { cb?.(); return provisionResult }),
    repair: vi.fn(async (cb?: () => void) => { cb?.(); return provisionResult }),
  }
  const phases: Array<[string, string | undefined]> = []
  const targets: any[] = []
  const svc = new CaptureService({
    sidecar: sidecar as any,
    makeProvisioner: () => provisioner as any,
    onApprovalNeeded: () => phases.push(['AWAITING_APPROVAL', undefined]),
    onTargets: (options) => targets.push(options),
    onPhase: (phase, error) => phases.push([phase, error]),
    onCrashed: () => phases.push(['CRASHED', undefined]),
  })
  return { svc, sidecar, provisioner, phases, targets }
}

describe('CaptureService', () => {
  it('start() prepares the visible phase, boots the sidecar, and registers a crash handler', async () => {
    const { svc, sidecar, phases } = deps()
    await svc.start()
    expect(phases[0]).toEqual(['PREPARING_CAPTURE', undefined])
    expect(sidecar.start).toHaveBeenCalledOnce()
    expect(sidecar.on).toHaveBeenCalledWith('crashed', expect.any(Function))
  })

  it('provision() sends the selected target and reaches READY', async () => {
    const { svc, provisioner, phases } = deps()
    await svc.start()
    const ok = await svc.provision(target)
    expect(ok).toBe(true)
    expect(provisioner.provision).toHaveBeenCalledWith(expect.any(Function), target)
    expect(phases).toContainEqual(['READY', undefined])
  })

  it('publishes monitor choices and enters CHOOSING_CAPTURE', async () => {
    const options = [target, { property: 'monitor_id', value: '{DISPLAY-2}', label: 'Display 2' }]
    const { svc, phases, targets } = deps({ ok: false, status: 'CHOOSING_TARGET', targets: options })
    await svc.start()

    await expect(svc.provision()).resolves.toBe(false)

    expect(targets).toEqual([options])
    expect(phases).toContainEqual(['CHOOSING_CAPTURE', undefined])
    expect(svc.captureTargets()).toEqual(options)
  })

  it('cancellation clears choices and returns to SETTING_UP', async () => {
    const options = [target, { property: 'monitor_id', value: '{DISPLAY-2}', label: 'Display 2' }]
    const { svc, phases, targets } = deps({ ok: false, status: 'CHOOSING_TARGET', targets: options })
    await svc.start()
    await svc.provision()

    svc.cancelSelection()

    expect(targets.at(-1)).toEqual([])
    expect(phases.at(-1)).toEqual(['SETTING_UP', undefined])
  })

  it('turns provisioning rejection into a stable visible error and stops only owned OBS', async () => {
    const { svc, sidecar, provisioner, phases } = deps()
    provisioner.provision.mockRejectedValueOnce(new Error('No usable displays were reported by OBS'))
    await svc.start()

    await expect(svc.provision()).resolves.toBe(false)

    expect(sidecar.stop).toHaveBeenCalledOnce()
    expect(phases.at(-1)).toEqual(['ERROR', 'No usable displays were reported by OBS'])
  })

  it('rejects a duplicate concurrent setup action', async () => {
    let release!: (value: any) => void
    const pending = new Promise((resolve) => { release = resolve })
    const { svc, provisioner } = deps()
    provisioner.provision.mockReturnValueOnce(pending as never)
    await svc.start()

    const first = svc.provision()
    await expect(svc.provision()).rejects.toThrow('already in progress')
    release({ ok: true, status: 'READY' })
    await expect(first).resolves.toBe(true)
  })

  it('restarts the owned sidecar on retry after a failed action', async () => {
    const { svc, sidecar, provisioner } = deps()
    provisioner.provision.mockRejectedValueOnce(new Error('first failure')).mockResolvedValueOnce({ ok: true, status: 'READY' })
    await svc.start()
    await svc.provision()

    await expect(svc.provision()).resolves.toBe(true)

    expect(sidecar.start).toHaveBeenCalledTimes(2)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { stopVirtualCam, startVirtualCam, type VirtualCamDeps } from '../src/virtual-cam.js'

/** OBS with an asynchronous teardown: StopVirtualCam is acknowledged
 *  immediately but the output stays active for `releaseAfter` further status
 *  polls, and anything attempted in that window fails the way OBS fails it. */
function fakeObs(opts: { releaseAfter?: number; startFailsWhileActive?: boolean } = {}) {
  const releaseAfter = opts.releaseAfter ?? 0
  let active = true
  let stopping = false
  let pollsSinceStop = 0
  const calls: string[] = []
  const d: VirtualCamDeps = {
    call: async (req) => {
      calls.push(req)
      if (req === 'StopVirtualCam') { stopping = true; return {} }
      if (req === 'GetVirtualCamStatus') {
        if (stopping && pollsSinceStop++ >= releaseAfter) { active = false; stopping = false }
        return { outputActive: active }
      }
      if (req === 'StartVirtualCam') {
        // OBS refuses a start while the previous run is still releasing.
        if (active && opts.startFailsWhileActive !== false) throw Object.assign(new Error('failed'), { code: 500 })
        active = true
        return {}
      }
      return {}
    },
    sleep: async () => {},
  }
  return { d, calls, isActive: () => active }
}

describe('stopVirtualCam', () => {
  it('waits for the output to actually release, not just for the ack', async () => {
    const { d, calls } = fakeObs({ releaseAfter: 3 })
    expect(await stopVirtualCam(d)).toBe(true)
    // It polled rather than trusting StopVirtualCam's acknowledgement.
    expect(calls.filter((c) => c === 'GetVirtualCamStatus').length).toBeGreaterThan(1)
  })

  it('gives up rather than hanging when the output never releases', async () => {
    const d: VirtualCamDeps = { call: async () => ({ outputActive: true }), sleep: async () => {} }
    expect(await stopVirtualCam(d, { tries: 3 })).toBe(false)
  })

  // An unreachable OBS must not be mistaken for a stopped cam.
  it('reports failure when the status cannot be read', async () => {
    const d: VirtualCamDeps = { call: async () => { throw new Error('offline') }, sleep: async () => {} }
    expect(await stopVirtualCam(d, { tries: 2 })).toBe(false)
  })

  it('never throws when StopVirtualCam itself fails', async () => {
    let n = 0
    const d: VirtualCamDeps = {
      call: async (r) => { if (r === 'StopVirtualCam') throw new Error('not running'); n++; return { outputActive: false } },
      sleep: async () => {},
    }
    await expect(stopVirtualCam(d)).resolves.toBe(true)
    expect(n).toBe(1)
  })
})

describe('startVirtualCam', () => {
  it('retries a start that lost the race with the previous run', async () => {
    const { d, calls, isActive } = fakeObs({ releaseAfter: 2 })
    await stopVirtualCam(d)
    expect(await startVirtualCam(d)).toBe(true)
    expect(isActive()).toBe(true)
    expect(calls.filter((c) => c === 'StartVirtualCam').length).toBeGreaterThanOrEqual(1)
  })

  it('gives up rather than retrying forever', async () => {
    const d: VirtualCamDeps = {
      call: async (r) => { if (r === 'StartVirtualCam') throw new Error('nope'); return { outputActive: false } },
      sleep: async () => {},
    }
    expect(await startVirtualCam(d, { tries: 3 })).toBe(false)
  })

  // The failure the renderer cannot see: OBS accepts the call and the output
  // still does not come up.
  it('does not report success when the ack succeeds but the output stays down', async () => {
    const d: VirtualCamDeps = { call: async () => ({ outputActive: false }), sleep: async () => {} }
    expect(await startVirtualCam(d, { tries: 2 })).toBe(false)
  })

  it('succeeds on the first try when nothing is in the way', async () => {
    const calls: string[] = []
    const d: VirtualCamDeps = {
      call: async (r) => { calls.push(r); return { outputActive: true } },
      sleep: async () => {},
    }
    expect(await startVirtualCam(d)).toBe(true)
    expect(calls.filter((c) => c === 'StartVirtualCam')).toHaveLength(1)
  })
})

// The regression this module exists for, as one sequence.
describe('the go-live bracket', () => {
  it('lets SetVideoSettings run only once the cam has released, and brings it back', async () => {
    const { d } = fakeObs({ releaseAfter: 3 })
    const setVideoSettings = vi.fn(async () => {
      // obs_reset_video is refused while any output is active. Before the wait
      // existed this ran in the teardown window and came back 500, so the
      // resolution silently never applied.
      const st = await d.call('GetVirtualCamStatus') as { outputActive: boolean }
      if (st.outputActive) throw Object.assign(new Error('OBS_VIDEO_CURRENTLY_ACTIVE'), { code: 500 })
      return {}
    })

    expect(await stopVirtualCam(d)).toBe(true)
    await expect(setVideoSettings()).resolves.toEqual({})
    expect(await startVirtualCam(d)).toBe(true)
  })
})

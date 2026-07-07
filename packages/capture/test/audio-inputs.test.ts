import { describe, it, expect, vi } from 'vitest'
import { ensureAudioInputs } from '../src/audio-inputs.js'

function recorder(responses: Record<string, any> = {}) {
  const calls: { req: string; data: any }[] = []
  const client = {
    call: vi.fn(async (req: string, data?: any) => { calls.push({ req, data }); return responses[req] ?? {} }),
  }
  return { calls, client }
}

describe('ensureAudioInputs', () => {
  it('creates desktop + muted mic inputs and sets the AAC encoder when absent', async () => {
    const r = recorder({ GetInputList: { inputs: [{ inputName: 'AxiStream Capture' }] } })
    await ensureAudioInputs(r.client)
    const creates = r.calls.filter((c) => c.req === 'CreateInput').map((c) => c.data)
    expect(creates).toEqual([
      { sceneName: 'Main', inputName: 'AxiStream Desktop Audio', inputKind: 'pulse_output_capture', inputSettings: {} },
      { sceneName: 'Main', inputName: 'AxiStream Mic', inputKind: 'pulse_input_capture', inputSettings: { device_id: 'default' } },
    ])
    expect(r.calls).toContainEqual({ req: 'SetInputMute', data: { inputName: 'AxiStream Mic', inputMuted: true } })
    expect(r.calls).toContainEqual({ req: 'SetProfileParameter', data: { parameterCategory: 'SimpleOutput', parameterName: 'ABitrate', parameterValue: '160' } })
    expect(r.calls).toContainEqual({ req: 'SetProfileParameter', data: { parameterCategory: 'Audio', parameterName: 'SampleRate', parameterValue: '48000' } })
    expect(r.calls).toContainEqual({ req: 'SetProfileParameter', data: { parameterCategory: 'Audio', parameterName: 'ChannelSetup', parameterValue: 'Stereo' } })
  })

  it('is idempotent — skips creation when both inputs already exist', async () => {
    const r = recorder({ GetInputList: { inputs: [
      { inputName: 'AxiStream Desktop Audio' }, { inputName: 'AxiStream Mic' },
    ] } })
    await ensureAudioInputs(r.client)
    expect(r.calls.filter((c) => c.req === 'CreateInput')).toEqual([])
    // encoder params are still (re)asserted — idempotent
    expect(r.calls.some((c) => c.req === 'SetProfileParameter')).toBe(true)
  })

  it('is best-effort — swallows a thrown client error (never throws out)', async () => {
    const client = { call: vi.fn(async () => { throw new Error('no audio server') }) }
    await expect(ensureAudioInputs(client)).resolves.toBeUndefined()
  })

  // A capture rebuild (RemoveScene+CreateScene in the provisioner) destroys the
  // scene ITEMS while the inputs survive in the collection — an input with no
  // item in the program scene is inactive and silent on stream. The existing
  // inputs must get their scene items re-added, mirroring GameAudioController.
  it('re-adds missing scene items for existing inputs after a scene rebuild', async () => {
    const calls: { req: string; data: any }[] = []
    const client = { call: vi.fn(async (req: string, data?: any) => {
      calls.push({ req, data })
      if (req === 'GetInputList') return { inputs: [{ inputName: 'AxiStream Desktop Audio' }, { inputName: 'AxiStream Mic' }] }
      if (req === 'GetSceneItemId') throw new Error('scene item not found')
      return {}
    }) }
    await ensureAudioInputs(client)
    const readds = calls.filter((c) => c.req === 'CreateSceneItem').map((c) => c.data)
    expect(readds).toEqual([
      { sceneName: 'Main', sourceName: 'AxiStream Desktop Audio' },
      { sceneName: 'Main', sourceName: 'AxiStream Mic' },
    ])
    expect(calls.filter((c) => c.req === 'CreateInput')).toEqual([])
  })

  it('leaves scene items alone when they still exist', async () => {
    const r = recorder({ GetInputList: { inputs: [
      { inputName: 'AxiStream Desktop Audio' }, { inputName: 'AxiStream Mic' },
    ] }, GetSceneItemId: { sceneItemId: 7 } })
    await ensureAudioInputs(r.client)
    expect(r.calls.filter((c) => c.req === 'CreateSceneItem')).toEqual([])
  })
})

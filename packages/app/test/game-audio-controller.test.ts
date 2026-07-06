import { describe, it, expect, vi } from 'vitest'
import { GameAudioController, GAME_AUDIO, GAME_AUDIO_KIND } from '../src/main/GameAudioController.js'

function recorder(opts: { inputs?: string[]; noSceneItem?: boolean; items?: { itemName: string; itemValue: string }[] } = {}) {
  const calls: { req: string; data: any }[] = []
  const client = () => ({
    call: vi.fn(async (req: string, data?: any) => {
      calls.push({ req, data })
      if (req === 'GetInputList') return { inputs: (opts.inputs ?? []).map((inputName) => ({ inputName })) }
      if (req === 'GetSceneItemId') {
        if (opts.noSceneItem) throw new Error('not in scene')
        return { sceneItemId: 7 }
      }
      if (req === 'CreateSceneItem') return { sceneItemId: 8 }
      if (req === 'GetInputPropertiesListPropertyItems') return { propertyItems: opts.items ?? [] }
      return {}
    }),
  })
  return { calls, client }
}

describe('GameAudioController.ensure', () => {
  it('does nothing when disabled and the input does not exist (zero footprint)', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: false, gameAudioTarget: null })
    expect(r.calls.map((c) => c.req)).toEqual(['GetInputList'])
  })

  it('first enable creates the input with exact kind and settings, then unmutes', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: true, gameAudioTarget: 'gw2-64.exe' })
    const create = r.calls.find((c) => c.req === 'CreateInput')
    expect(create?.data).toEqual({
      sceneName: 'Main', inputName: GAME_AUDIO, inputKind: GAME_AUDIO_KIND,
      inputSettings: { CaptureMode: 0, TargetName: 'gw2-64.exe', MatchPriorty: 0 },
    })
    const mute = r.calls.find((c) => c.req === 'SetInputMute')
    expect(mute?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: false })
  })

  it('null target creates with empty TargetName', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: true, gameAudioTarget: null })
    expect(r.calls.find((c) => c.req === 'CreateInput')?.data.inputSettings.TargetName).toBe('')
  })

  it('existing input gets SetInputSettings (no duplicate CreateInput) and mute state', async () => {
    const r = recorder({ inputs: [GAME_AUDIO] })
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: false, gameAudioTarget: 'gw2-64.exe' })
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(false)
    expect(r.calls.find((c) => c.req === 'SetInputSettings')?.data).toEqual({
      inputName: GAME_AUDIO, inputSettings: { CaptureMode: 0, TargetName: 'gw2-64.exe', MatchPriorty: 0 }, overlay: true,
    })
    expect(r.calls.find((c) => c.req === 'SetInputMute')?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: true })
  })

  it('re-adds the scene item when a rebuild dropped it', async () => {
    const r = recorder({ inputs: [GAME_AUDIO], noSceneItem: true })
    await new GameAudioController({ client: r.client }).ensure({ gameAudioEnabled: true, gameAudioTarget: 'x' })
    expect(r.calls.find((c) => c.req === 'CreateSceneItem')?.data).toEqual({ sceneName: 'Main', sourceName: GAME_AUDIO })
  })

  it('throwing client is swallowed', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    await expect(new GameAudioController({ client }).ensure({ gameAudioEnabled: true, gameAudioTarget: null })).resolves.toBeUndefined()
  })
})

describe('GameAudioController.listApps / setTarget / setEnabled', () => {
  it('listApps maps TargetName property items to {id,name}', async () => {
    const r = recorder({ items: [{ itemName: 'Guild Wars 2', itemValue: 'gw2-64.exe' }] })
    const apps = await new GameAudioController({ client: r.client }).listApps()
    expect(apps).toEqual([{ id: 'gw2-64.exe', name: 'Guild Wars 2' }])
    expect(r.calls[0].data).toEqual({ inputName: GAME_AUDIO, propertyName: 'TargetName' })
  })

  it('listApps returns [] on error', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('no input') }) })
    await expect(new GameAudioController({ client }).listApps()).resolves.toEqual([])
  })

  it('setTarget overlays TargetName; setEnabled toggles mute', async () => {
    const r = recorder()
    const g = new GameAudioController({ client: r.client })
    await g.setTarget('gw2-64.exe')
    expect(r.calls[0]).toEqual({ req: 'SetInputSettings', data: { inputName: GAME_AUDIO, inputSettings: { TargetName: 'gw2-64.exe' }, overlay: true } })
    await g.setEnabled(true)
    expect(r.calls[1]).toEqual({ req: 'SetInputMute', data: { inputName: GAME_AUDIO, inputMuted: false } })
  })
})

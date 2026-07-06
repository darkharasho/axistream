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

const appsArr = (...values: string[]) => values.map((value) => ({ value, hidden: false, selected: false }))

describe('GameAudioController.ensure (multi-app)', () => {
  it('empty selection + missing input creates the input (empty apps array) and mutes it', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioApps: [] })
    const create = r.calls.find((c) => c.req === 'CreateInput')
    expect(create?.data).toEqual({
      sceneName: 'Main', inputName: GAME_AUDIO, inputKind: GAME_AUDIO_KIND,
      inputSettings: { CaptureMode: 1, apps: [], MatchPriorty: 0 },
    })
    expect(r.calls.find((c) => c.req === 'SetInputMute')?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: true })
  })

  it('first selection creates the input with CaptureMode 1 and the plugin apps format, then unmutes', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).ensure({ gameAudioApps: ['gw2-64.exe', 'Discord'] })
    const create = r.calls.find((c) => c.req === 'CreateInput')
    expect(create?.data).toEqual({
      sceneName: 'Main', inputName: GAME_AUDIO, inputKind: GAME_AUDIO_KIND,
      inputSettings: { CaptureMode: 1, apps: appsArr('gw2-64.exe', 'Discord'), MatchPriorty: 0 },
    })
    expect(r.calls.find((c) => c.req === 'SetInputMute')?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: false })
  })

  it('existing input gets SetInputSettings with the new apps array and mute when emptied', async () => {
    const r = recorder({ inputs: [GAME_AUDIO] })
    await new GameAudioController({ client: r.client }).ensure({ gameAudioApps: [] })
    expect(r.calls.some((c) => c.req === 'CreateInput')).toBe(false)
    expect(r.calls.find((c) => c.req === 'SetInputSettings')?.data).toEqual({
      inputName: GAME_AUDIO, inputSettings: { CaptureMode: 1, apps: [], MatchPriorty: 0 }, overlay: true,
    })
    expect(r.calls.find((c) => c.req === 'SetInputMute')?.data).toEqual({ inputName: GAME_AUDIO, inputMuted: true })
  })

  it('re-adds the scene item when a rebuild dropped it', async () => {
    const r = recorder({ inputs: [GAME_AUDIO], noSceneItem: true })
    await new GameAudioController({ client: r.client }).ensure({ gameAudioApps: ['x'] })
    expect(r.calls.find((c) => c.req === 'CreateSceneItem')?.data).toEqual({ sceneName: 'Main', sourceName: GAME_AUDIO })
  })

  it('throwing client is swallowed', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('boom') }) })
    await expect(new GameAudioController({ client }).ensure({ gameAudioApps: ['x'] })).resolves.toBeUndefined()
  })
})

describe('GameAudioController.listApps / setEnabled', () => {
  it('listApps enumerates the AppToAdd property', async () => {
    const r = recorder({ items: [{ itemName: 'Guild Wars 2', itemValue: 'gw2-64.exe' }] })
    const apps = await new GameAudioController({ client: r.client }).listApps()
    expect(apps).toEqual([{ id: 'gw2-64.exe', name: 'Guild Wars 2' }])
    expect(r.calls[0].data).toEqual({ inputName: GAME_AUDIO, propertyName: 'AppToAdd' })
  })

  it('listApps returns [] on error', async () => {
    const client = () => ({ call: vi.fn(async () => { throw new Error('no input') }) })
    await expect(new GameAudioController({ client }).listApps()).resolves.toEqual([])
  })

  it('setEnabled toggles mute', async () => {
    const r = recorder()
    await new GameAudioController({ client: r.client }).setEnabled(true)
    expect(r.calls[0]).toEqual({ req: 'SetInputMute', data: { inputName: GAME_AUDIO, inputMuted: false } })
  })
})

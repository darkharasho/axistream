import type { AudioDevice } from './AudioController.js'

export const GAME_AUDIO = 'AxiStream Game Audio'
export const GAME_AUDIO_KIND = 'pipewire_audio_application_capture'
const SCENE = 'Main'

export interface GameAudioDeps {
  client(): { call(req: string, data?: unknown): Promise<any> }
}

// Reconciles the per-app game-audio input (PipeWire app capture plugin)
// against the persisted settings. No input exists until the feature is
// first enabled; disabled thereafter means muted, mirroring desktop/mic.
// Settings keys (CaptureMode/TargetName/MatchPriorty — the plugin's own
// spelling) are live-probed ground truth; see the spec's ground-truth
// section. Best-effort throughout — never blocks boot or go-live.
export class GameAudioController {
  constructor(private readonly d: GameAudioDeps) {}

  private settingsFor(apps: string[]) {
    // Plugin multi-app format: it reads only `value` from each item
    // (pipewire-audio-capture-app.c); hidden/selected are the OBS
    // editable-list conventions.
    return { CaptureMode: 1, apps: apps.map((value) => ({ value, hidden: false, selected: false })), MatchPriorty: 0 }
  }

  async ensure(s: { gameAudioApps: string[] }): Promise<void> {
    try {
      const c = this.d.client()
      const { inputs } = await c.call('GetInputList') as { inputs?: { inputName: string }[] }
      const exists = (inputs ?? []).some((i) => i.inputName === GAME_AUDIO)
      if (!exists && s.gameAudioApps.length === 0) return
      if (!exists) {
        await c.call('CreateInput', { sceneName: SCENE, inputName: GAME_AUDIO, inputKind: GAME_AUDIO_KIND, inputSettings: this.settingsFor(s.gameAudioApps) })
      } else {
        await c.call('SetInputSettings', { inputName: GAME_AUDIO, inputSettings: this.settingsFor(s.gameAudioApps), overlay: true })
        // A capture rebuild recreates the scene but not its items — re-add.
        try { await c.call('GetSceneItemId', { sceneName: SCENE, sourceName: GAME_AUDIO }) }
        catch { await c.call('CreateSceneItem', { sceneName: SCENE, sourceName: GAME_AUDIO }) }
      }
      await c.call('SetInputMute', { inputName: GAME_AUDIO, inputMuted: s.gameAudioApps.length === 0 })
    } catch (e) { console.warn('[game-audio] ensure failed', e) }
  }

  async listApps(): Promise<AudioDevice[]> {
    try {
      const r = await this.d.client().call('GetInputPropertiesListPropertyItems', {
        inputName: GAME_AUDIO, propertyName: 'AppToAdd',
      })
      return (r.propertyItems ?? []).map((it: { itemName: string; itemValue: string }) => ({ id: it.itemValue, name: it.itemName }))
    } catch (e) { console.warn('[game-audio] listApps failed', e); return [] }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    try { await this.d.client().call('SetInputMute', { inputName: GAME_AUDIO, inputMuted: !enabled }) }
    catch (e) { console.warn('[game-audio] setEnabled failed', e) }
  }
}

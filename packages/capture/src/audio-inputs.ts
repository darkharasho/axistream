const SCENE = 'Main'
const DESKTOP_AUDIO = 'AxiStream Desktop Audio'
const MIC = 'AxiStream Mic'
const DESKTOP_KIND = 'pulse_output_capture'
const MIC_KIND = 'pulse_input_capture'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AudioCapableClient { call(req: string, data?: any): Promise<any> }

// A capture rebuild (RemoveScene+CreateScene) destroys the scene ITEMS while
// the inputs survive in the collection — and an input with no item in the
// program scene is inactive, i.e. silent on stream. Re-add, mirroring
// GameAudioController.
async function ensureSceneItem(client: AudioCapableClient, sourceName: string): Promise<void> {
  try { await client.call('GetSceneItemId', { sceneName: SCENE, sourceName }) }
  catch { await client.call('CreateSceneItem', { sceneName: SCENE, sourceName }) }
}

// Best-effort and idempotent: ensure the desktop + mic audio inputs exist (mic
// created muted) and the AAC encoder params are set. Safe to run on EVERY boot —
// it skips inputs that already exist, which lets installs provisioned before the
// audio feature self-heal (audio-input creation used to live only in first-time
// provisioning). Never throws — silent audio must not break boot or go-live.
export async function ensureAudioInputs(client: AudioCapableClient): Promise<void> {
  try {
    const { inputs } = await client.call('GetInputList')
    const have = new Set((inputs ?? []).map((i: { inputName: string }) => i.inputName))
    if (!have.has(DESKTOP_AUDIO)) {
      await client.call('CreateInput', { sceneName: SCENE, inputName: DESKTOP_AUDIO, inputKind: DESKTOP_KIND, inputSettings: {} })
    } else {
      await ensureSceneItem(client, DESKTOP_AUDIO)
    }
    if (!have.has(MIC)) {
      await client.call('CreateInput', { sceneName: SCENE, inputName: MIC, inputKind: MIC_KIND, inputSettings: { device_id: 'default' } })
      await client.call('SetInputMute', { inputName: MIC, inputMuted: true })
    } else {
      await ensureSceneItem(client, MIC)
    }
    await client.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: 'ABitrate', parameterValue: '160' })
    await client.call('SetProfileParameter', { parameterCategory: 'Audio', parameterName: 'SampleRate', parameterValue: '48000' })
    await client.call('SetProfileParameter', { parameterCategory: 'Audio', parameterName: 'ChannelSetup', parameterValue: 'Stereo' })
  } catch (e) {
    console.warn('[audio] ensureAudioInputs failed', e)
  }
}

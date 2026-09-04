import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MAX_MASKS, type MaskRect, type WebcamCorner, type WebcamMode, type WebcamConfig, WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT, DEFAULT_WEBCAM, QUALITY_HEIGHTS, QUALITY_FPS, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS } from '../shared/state.js'
import { DEFAULT_HOTKEYS, HOTKEY_IDS, type PersistedBinding, type PersistedHotkeys } from '../shared/hotkeys.js'
import { ENCODER_ENTRIES, type EncoderId } from '@axistream/capture'

export type Privacy = 'public' | 'unlisted' | 'private'
export type MaskStyle = 'box' | 'blur'

export interface StreamSettingsData {
  titleTemplate: string
  dateFormat: string
  privacy: Privacy
  counter: number
  streamId: string | null
  desktopEnabled: boolean
  micEnabled: boolean
  micDevice: string | null
  desktopDevice: string | null
  masks: MaskRect[]
  /** The user's encoder choice. 'auto' = detect. Migrated from the old
   *  preferSoftware boolean, which meant exactly 'x264'. */
  encoder: EncoderId
  gameAudioApps: string[]
  maskStyle: MaskStyle
  discordWebhookUrl: string
  discordMessage: string
  pttEnabled: boolean
  masksVisible: boolean
  pttKeyCode: number
  pttKeyName: string
  pttModifier: '' | 'ctrl' | 'alt' | 'shift' | 'super'
  lastSeenVersion: string
  /** The app version at which the user finished or dismissed the welcome
   *  wizard. '' means it has never been seen. A string rather than a boolean
   *  so a later release can re-run onboarding without a settings migration;
   *  1.0 only ever asks whether it is empty. */
  onboardedVersion: string
  recordDir: string
  webcam: WebcamConfig
  /** null = Auto. Auto tracks the monitor (capped at 1440) and 60fps, and
   *  derives bitrate from those two — see choosePreset in @axistream/capture. */
  qualityHeight: number | null
  qualityFps: number | null
  qualityBitrateKbps: number | null
  /** True when the failed-go-live retry chose the encoder, not the user.
   *  Affects the settings panel's help text only, never behavior. */
  encoderAuto: boolean
  hotkeys: PersistedHotkeys
}

export const DEFAULT_SETTINGS: StreamSettingsData = {
  titleTemplate: '{{date}} WvW Raid - {{team}} - {{class}} - {{map}}',
  dateFormat: 'YYYY-MM-DD',
  privacy: 'public',
  counter: 0,
  streamId: null,
  desktopEnabled: true,
  micEnabled: false,
  micDevice: null,
  desktopDevice: null,
  masks: [],
  encoder: 'auto',
  gameAudioApps: [],
  maskStyle: 'box',
  discordWebhookUrl: '',
  discordMessage: '',
  pttEnabled: false,
  masksVisible: true,
  pttKeyCode: 188,
  pttKeyName: 'F18',
  pttModifier: '',
  lastSeenVersion: '',
  onboardedVersion: '',
  recordDir: '',
  webcam: { ...DEFAULT_WEBCAM },
  qualityHeight: null,
  qualityFps: null,
  qualityBitrateKbps: null,
  encoderAuto: false,
  hotkeys: DEFAULT_HOTKEYS,
}

const PRIVACIES: Privacy[] = ['public', 'unlisted', 'private']
const MASK_STYLES: MaskStyle[] = ['box', 'blur']

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const CORNERS: WebcamCorner[] = ['tl', 'tr', 'bl', 'br']

/** An off-list value means a hand-edited or corrupt file — degrade to Auto
 *  rather than asking an encoder for a resolution nothing can produce. */
const oneOf = (raw: unknown, allowed: number[]): number | null =>
  typeof raw === 'number' && allowed.includes(raw) ? raw : null

/** Bitrate is a continuous range, so a plausible out-of-range number is a
 *  typo worth clamping rather than discarding. */
const bitrateOf = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw)
    ? Math.round(clamp(raw, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS))
    : null

const ENCODER_IDS: readonly EncoderId[] = ['auto', ...ENCODER_ENTRIES.map((e) => e.id)]

/** A settings file can carry an id from a newer build, a hand edit, or the
 *  pre-picker boolean. Anything unrecognized falls back to auto rather than
 *  reaching OBS. */
function readEncoderId(raw: Record<string, unknown>): EncoderId {
  const stored = raw.encoder
  if (typeof stored === 'string' && (ENCODER_IDS as readonly string[]).includes(stored)) return stored as EncoderId
  if (raw.preferSoftware === true) return 'x264'
  return DEFAULT_SETTINGS.encoder
}

const MODIFIERS = ['ctrl', 'alt', 'shift', 'super']

/** A malformed entry becomes null (unbound), never a fallback key: a corrupted
 *  settings file must not silently grab a key away from the game. */
function validBinding(raw: unknown): PersistedBinding | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Number.isInteger(r.code) || (r.code as number) < 1 || (r.code as number) > 767) return null
  if (typeof r.name !== 'string' || !r.name) return null
  if (r.modifier !== '' && !MODIFIERS.includes(r.modifier as string)) return null
  return { code: r.code as number, name: r.name, modifier: r.modifier as PersistedBinding['modifier'] }
}

function validHotkeys(raw: unknown): PersistedHotkeys {
  const src = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const out = {} as PersistedHotkeys
  for (const id of HOTKEY_IDS) out[id] = validBinding(src[id])
  return out
}

export function sanitizeWebcam(raw: unknown): WebcamConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_WEBCAM }
  const r = raw as Record<string, unknown>
  // A mode is all three properties or none — a resolution without its pixel
  // format is exactly the broken combination the override exists to avoid.
  let mode: WebcamMode | null = null
  const m = r.mode
  if (typeof m === 'object' && m !== null) {
    const { pixelformat, resolution, framerate } = m as Record<string, unknown>
    if (typeof pixelformat === 'string' && pixelformat && typeof resolution === 'string' && resolution && typeof framerate === 'string' && framerate) {
      mode = { pixelformat, resolution, framerate }
    }
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_WEBCAM.enabled,
    deviceId: typeof r.deviceId === 'string' && r.deviceId ? r.deviceId : null,
    deviceLabel: typeof r.deviceLabel === 'string' && r.deviceLabel ? r.deviceLabel : null,
    corner: CORNERS.includes(r.corner as WebcamCorner) ? (r.corner as WebcamCorner) : DEFAULT_WEBCAM.corner,
    sizePct: typeof r.sizePct === 'number' && Number.isFinite(r.sizePct)
      ? clamp(r.sizePct, WEBCAM_MIN_SIZE_PCT, WEBCAM_MAX_SIZE_PCT)
      : DEFAULT_WEBCAM.sizePct,
    mirrored: typeof r.mirrored === 'boolean' ? r.mirrored : DEFAULT_WEBCAM.mirrored,
    mode,
  }
}

export function sanitizeMasks(raw: unknown): MaskRect[] {
  if (!Array.isArray(raw)) return []
  const out: MaskRect[] = []
  for (const m of raw) {
    if (out.length >= MAX_MASKS) break
    if (typeof m !== 'object' || m === null) continue
    const { id, x, y, w, h } = m as Record<string, unknown>
    if (typeof id !== 'string' || !id) continue
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    out.push({ id, x: clamp(x as number, 0, 1), y: clamp(y as number, 0, 1), w: clamp(w as number, 0.01, 1), h: clamp(h as number, 0.01, 1) })
  }
  return out
}

export function sanitizeGameAudioApps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (out.length >= 16) break
    if (typeof v !== 'string') continue
    const name = v.trim()
    if (!name || out.includes(name)) continue
    out.push(name)
  }
  return out
}

export class StreamSettings {
  constructor(private readonly filePath: string) {}

  load(): StreamSettingsData {
    if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StreamSettingsData>
      const r2 = raw as Record<string, unknown>
      const isLegacy = !('gameAudioApps' in raw)
      const gameAudioApps = isLegacy
        ? (r2.gameAudioEnabled === true && typeof r2.gameAudioTarget === 'string' && (r2.gameAudioTarget as string).trim()
            ? [(r2.gameAudioTarget as string).trim()]
            : [])
        : sanitizeGameAudioApps(raw.gameAudioApps)
      const rawDesktopEnabled = typeof raw.desktopEnabled === 'boolean' ? raw.desktopEnabled : DEFAULT_SETTINGS.desktopEnabled
      // Legacy migration: old schema allowed desktopEnabled + gameAudioEnabled both true; force off desktop when migrating a non-empty app list
      const desktopEnabled = isLegacy && gameAudioApps.length > 0 ? false : rawDesktopEnabled
      return {
        titleTemplate: typeof raw.titleTemplate === 'string' ? raw.titleTemplate : DEFAULT_SETTINGS.titleTemplate,
        dateFormat: typeof raw.dateFormat === 'string' && raw.dateFormat ? raw.dateFormat : DEFAULT_SETTINGS.dateFormat,
        privacy: PRIVACIES.includes(raw.privacy as Privacy) ? (raw.privacy as Privacy) : DEFAULT_SETTINGS.privacy,
        counter: Number.isInteger(raw.counter) ? (raw.counter as number) : DEFAULT_SETTINGS.counter,
        streamId: typeof raw.streamId === 'string' ? raw.streamId : null,
        desktopEnabled,
        micEnabled: typeof raw.micEnabled === 'boolean' ? raw.micEnabled : DEFAULT_SETTINGS.micEnabled,
        micDevice: typeof raw.micDevice === 'string' ? raw.micDevice : null,
        desktopDevice: typeof raw.desktopDevice === 'string' ? raw.desktopDevice : null,
        masks: sanitizeMasks(raw.masks),
        encoder: readEncoderId(r2),
        gameAudioApps,
        maskStyle: MASK_STYLES.includes(raw.maskStyle as MaskStyle) ? (raw.maskStyle as MaskStyle) : DEFAULT_SETTINGS.maskStyle,
        discordWebhookUrl: typeof raw.discordWebhookUrl === 'string' ? raw.discordWebhookUrl : DEFAULT_SETTINGS.discordWebhookUrl,
        discordMessage: typeof raw.discordMessage === 'string' ? raw.discordMessage : DEFAULT_SETTINGS.discordMessage,
        pttEnabled: typeof raw.pttEnabled === 'boolean' ? raw.pttEnabled : DEFAULT_SETTINGS.pttEnabled,
        masksVisible: typeof raw.masksVisible === 'boolean' ? raw.masksVisible : DEFAULT_SETTINGS.masksVisible,
        pttKeyCode: Number.isInteger(raw.pttKeyCode) && (raw.pttKeyCode as number) >= 1 && (raw.pttKeyCode as number) <= 767 ? raw.pttKeyCode as number : DEFAULT_SETTINGS.pttKeyCode,
        pttKeyName: typeof raw.pttKeyName === 'string' && raw.pttKeyName ? raw.pttKeyName : DEFAULT_SETTINGS.pttKeyName,
        pttModifier: raw.pttModifier === 'ctrl' || raw.pttModifier === 'alt' || raw.pttModifier === 'shift' || raw.pttModifier === 'super' ? raw.pttModifier : DEFAULT_SETTINGS.pttModifier,
        lastSeenVersion: typeof raw.lastSeenVersion === 'string' ? raw.lastSeenVersion : DEFAULT_SETTINGS.lastSeenVersion,
        onboardedVersion: typeof raw.onboardedVersion === 'string' ? raw.onboardedVersion : DEFAULT_SETTINGS.onboardedVersion,
        recordDir: typeof raw.recordDir === 'string' ? raw.recordDir : DEFAULT_SETTINGS.recordDir,
        webcam: sanitizeWebcam(raw.webcam),
        qualityHeight: oneOf(raw.qualityHeight, QUALITY_HEIGHTS),
        qualityFps: oneOf(raw.qualityFps, QUALITY_FPS),
        qualityBitrateKbps: bitrateOf(raw.qualityBitrateKbps),
        encoderAuto: typeof raw.encoderAuto === 'boolean' ? raw.encoderAuto : raw.preferSoftwareAuto === true,
        hotkeys: validHotkeys(raw.hotkeys),
      }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  save(data: StreamSettingsData): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(data, null, 2))
  }

  patch(p: Partial<StreamSettingsData>): StreamSettingsData {
    const next = { ...this.load(), ...p }
    this.save(next)
    return next
  }

  bumpCounter(): number {
    const next = this.load().counter + 1
    this.patch({ counter: next })
    return next
  }
}

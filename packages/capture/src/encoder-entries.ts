/** One row of the encoder picker. The vocabulary mirrors OBS Studio's own
 *  encoder dropdown, which is what the feature request asked for. */

export type EncoderId =
  | 'auto'
  | 'x264'
  | 'nvenc_h264' | 'nvenc_hevc' | 'nvenc_av1'
  | 'amd_h264' | 'amd_hevc'
  | 'vaapi_h264'

/** Every id except 'auto' — what a resolved selection can actually be. */
export type ResolvedEncoderId = Exclude<EncoderId, 'auto'>

export type Vendor = 'nvidia' | 'amd-intel' | 'none'

export type DisabledReason =
  | 'enhanced-rtmp'
  | 'no-nvidia'
  | 'no-amd'
  | 'amf-windows-only'
  | 'vaapi-advanced-mode'

export interface EncoderEntry {
  id: ResolvedEncoderId
  label: string
  /** The SimpleOutput/StreamEncoder value, or null when the encoder is not
   *  reachable from Simple output mode at all (VAAPI). */
  streamEncoder: string | null
  /** 'none' = runs anywhere. */
  vendor: Vendor
  /** HEVC and AV1 cannot go out over plain RTMP; YouTube ingests them only
   *  over enhanced-RTMP/RTMPS or HLS, and the go-live path builds plain RTMP. */
  needsEnhancedRtmp: boolean
}

export const ENCODER_ENTRIES: readonly EncoderEntry[] = [
  { id: 'x264', label: 'Software (x264)', streamEncoder: 'x264', vendor: 'none', needsEnhancedRtmp: false },
  { id: 'nvenc_h264', label: 'Hardware (NVENC, H.264)', streamEncoder: 'nvenc', vendor: 'nvidia', needsEnhancedRtmp: false },
  { id: 'nvenc_hevc', label: 'Hardware (NVENC, HEVC)', streamEncoder: 'nvenc_hevc', vendor: 'nvidia', needsEnhancedRtmp: true },
  { id: 'nvenc_av1', label: 'Hardware (NVENC, AV1)', streamEncoder: 'nvenc_av1', vendor: 'nvidia', needsEnhancedRtmp: true },
  { id: 'amd_h264', label: 'Hardware (AMD, H.264)', streamEncoder: 'amd', vendor: 'amd-intel', needsEnhancedRtmp: false },
  { id: 'amd_hevc', label: 'Hardware (AMD, HEVC)', streamEncoder: 'amd_hevc', vendor: 'amd-intel', needsEnhancedRtmp: true },
  // No streamEncoder: OBS's Simple output mode has no VAAPI mapping. Present
  // as a permanently-disabled row so Linux AMD/Intel users can see why their
  // hardware is idle instead of guessing. See the spec's follow-up list.
  { id: 'vaapi_h264', label: 'Hardware (VAAPI, H.264)', streamEncoder: null, vendor: 'amd-intel', needsEnhancedRtmp: false },
]

export function encoderEntry(id: ResolvedEncoderId): EncoderEntry {
  const found = ENCODER_ENTRIES.find((e) => e.id === id)
  if (!found) throw new Error(`unknown encoder id: ${id}`)
  return found
}

/** Why a row is unselectable, or 'ok'. Pure — the whole matrix is testable
 *  without OBS. Reasons are ordered most-actionable first: a user with the
 *  wrong GPU is told about the GPU, not about an ingest limit they could not
 *  hit anyway. */
export function encoderAvailability(
  entry: EncoderEntry, vendor: Vendor, platform: NodeJS.Platform,
): 'ok' | DisabledReason {
  if (entry.streamEncoder === null) return 'vaapi-advanced-mode'
  // AMF is the Windows AMD encoder; the Linux builds AxiStream ships do not
  // have it, so an AMD Linux box still cannot use these rows.
  if (entry.vendor === 'amd-intel' && platform !== 'win32') return 'amf-windows-only'
  if (entry.vendor !== 'none' && entry.vendor !== vendor) {
    return entry.vendor === 'nvidia' ? 'no-nvidia' : 'no-amd'
  }
  if (entry.needsEnhancedRtmp) return 'enhanced-rtmp'
  return 'ok'
}

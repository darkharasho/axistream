export interface DeviceOption { id: string; name: string }

/** When the saved device id isn't in the enumerated list (unplugged USB
 *  DAC), the bare <select value=...> matches no option and renders blank.
 *  This returns a labeled placeholder to render instead — OBS itself keeps
 *  working (it falls back internally when the id is gone). */
export function staleOption(saved: string | null, devices: DeviceOption[], label = 'Saved device (unavailable)'): DeviceOption | null {
  if (!saved) return null
  if (devices.some((d) => d.id === saved)) return null
  return { id: saved, name: label }
}

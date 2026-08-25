// `available` is a condition and lives in AppState as a chip; the toast
// channel carries only discrete events. So a toast fires on the edge into
// unavailable and never while the condition persists.
export function webcamToast(prev: boolean, next: boolean, enabled: boolean): 'unavailable' | null {
  if (!enabled) return null
  if (prev && !next) return 'unavailable'
  return null
}

/**
 * Whether a will-navigate target is the app navigating within itself, and may
 * therefore load in the AxiStream window.
 *
 * Origin comparison cannot answer this. A packaged build is loaded from a
 * file:// URL, and every file:// URL — plus every data:, blob: and about: URL
 * — reports the opaque origin, the string 'null', so an origin check calls all
 * of them same-origin and lets untrusted content load with this app's
 * preload. Compare the scheme explicitly, then the file for file:// and the
 * origin only where an origin means something.
 *
 * Anything unparseable is not the app navigating within itself, so it is
 * refused rather than waved through.
 */
export function isInAppNavigation(target: string, current: string): boolean {
  let to: URL
  let from: URL
  try {
    to = new URL(target)
    from = new URL(current)
  } catch { return false }
  if (to.protocol !== from.protocol) return false
  if (to.protocol === 'file:') return to.pathname === from.pathname
  if (to.protocol === 'http:' || to.protocol === 'https:') return to.origin === from.origin
  return false
}

// Coarse entropy proxy: an all-black frame compresses to a tiny, low-variety
// PNG. Require both meaningful size and byte variety.
export function isNonBlackPng(buf: Buffer): boolean {
  if (!buf || buf.length < 2000) return false
  const seen = new Set<number>()
  for (let i = 0; i < buf.length; i += 7) seen.add(buf[i])
  return seen.size > 20
}

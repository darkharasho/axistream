export interface GithubRelease { tag: string; body: string }

export function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null
  const parts = v.trim().replace(/^v/i, '').split('.').map((p) => Number.parseInt(p, 10))
  if (parts.some((n) => Number.isNaN(n))) return null
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

export function compareVersion(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/** GitHub-releases entries strictly newer than lastSeen and <= current,
 *  newest first, concatenated as markdown. null when the range is empty. */
export function selectReleaseNotes(releases: GithubRelease[], currentVersion: string, lastSeenVersion: string | null): string | null {
  const current = parseVersion(currentVersion)
  if (!current) return null
  const lastSeen = parseVersion(lastSeenVersion)
  const picked = releases
    .map((r) => ({ v: parseVersion(r.tag), r }))
    .filter((x): x is { v: number[]; r: GithubRelease } => x.v !== null)
    .filter((x) => compareVersion(x.v, current) <= 0 && (!lastSeen || compareVersion(x.v, lastSeen) > 0))
    .sort((a, b) => compareVersion(b.v, a.v))
  if (picked.length === 0) return null
  return picked.map((x) => `## ${x.r.tag}\n\n${x.r.body}`.trim()).join('\n\n')
}

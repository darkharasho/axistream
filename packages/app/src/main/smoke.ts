export interface SmokeResult { code: 0 | 1; summary: string }

export function createSmokeWatcher(
  onDone: (r: SmokeResult) => void,
  timeoutMs = 180000,
): { observe(phase: string, error: string | null): void; dispose(): void } {
  let settled = false
  let lastPhase = ''

  const settle = (r: SmokeResult) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    onDone(r)
  }

  const timer = setTimeout(() => {
    settle({ code: 1, summary: `SMOKE FAIL timeout after ${timeoutMs}ms lastPhase=${lastPhase}` })
  }, timeoutMs)

  return {
    observe(phase: string, error: string | null) {
      if (settled) return
      lastPhase = phase
      if (phase === 'READY' || phase === 'NEEDS_KEY' || phase === 'NEEDS_TITLE') {
        settle({ code: 0, summary: `SMOKE OK phase=${phase}` })
      } else if (phase === 'ERROR') {
        settle({ code: 1, summary: `SMOKE FAIL phase=ERROR error=${error}` })
      }
    },
    dispose() {
      settled = true
      clearTimeout(timer)
    },
  }
}

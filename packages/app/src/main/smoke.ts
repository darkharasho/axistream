export interface SmokeResult { code: 0 | 1; summary: string }

export function createSmokeWatcher(
  onDone: (r: SmokeResult) => void,
  timeoutMs = 180000,
): { observe(phase: string, error: string | null): void; succeed(summary: string): void; dispose(): void } {
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
    // Out-of-band success for outcomes the phase machine can't express —
    // e.g. provisioning completed on a headless runner whose frame check
    // can only ever see black. Same once-guard as observe.
    succeed(summary: string) {
      settle({ code: 0, summary })
    },
    dispose() {
      settled = true
      clearTimeout(timer)
    },
  }
}

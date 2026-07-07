export function AudioPulse({ level }: { level: number }) {
  const h = (f: number) => 3 + Math.min(1, level) * 9 * f
  return (
    <span className={`audio-pulse${level > 0.02 ? ' live' : ''}`} aria-hidden>
      <svg width="14" height="12" viewBox="0 0 14 12">
        <rect x="0" width="3" rx="1.5" y={12 - h(0.7)} height={h(0.7)} />
        <rect x="5.5" width="3" rx="1.5" y={12 - h(1)} height={h(1)} />
        <rect x="11" width="3" rx="1.5" y={12 - h(0.55)} height={h(0.55)} />
      </svg>
    </span>
  )
}

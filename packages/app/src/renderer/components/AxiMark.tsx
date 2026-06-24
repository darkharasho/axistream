// AxiStream duo-tone brand mark: a solid accent core with lighter signal arcs.
// Duo-tone = one accent hue at multiple opacities. Starting point — tune to the
// shared Axi house style.
export function AxiMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* outer signal wave (lightest) */}
      <path d="M4.8 4.8a10.2 10.2 0 0 0 0 14.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4"
        stroke="#22d3ee" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" />
      {/* inner signal wave (mid) */}
      <path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8M15.9 8.1a5.5 5.5 0 0 1 0 7.8"
        stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      {/* solid core (full) */}
      <circle cx="12" cy="12" r="3" fill="#22d3ee" />
    </svg>
  )
}

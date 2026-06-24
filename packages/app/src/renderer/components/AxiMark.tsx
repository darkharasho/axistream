// AxiStream brand mark — matches the Axi house style (duo-tone glyph: off-white
// main + accent at ~0.45). A broadcast/stream motif: signal arcs + a solid core.
export function AxiMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* accent back arcs (duo-tone secondary) */}
      <path d="M4.8 4.8a10.2 10.2 0 0 0 0 14.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4"
        stroke="#22d3ee" strokeOpacity="0.45" strokeWidth="2.2" strokeLinecap="round" />
      {/* main arcs (off-white) */}
      <path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8M15.9 8.1a5.5 5.5 0 0 1 0 7.8"
        stroke="#e4e3dc" strokeWidth="2.2" strokeLinecap="round" />
      {/* solid core (accent) */}
      <circle cx="12" cy="12" r="2.9" fill="#22d3ee" />
    </svg>
  )
}

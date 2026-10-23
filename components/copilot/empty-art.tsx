/**
 * Small inline illustrations for empty lists. Decorative (aria-hidden), drawn with theme tokens so they sit right in
 * both themes; the one moving part (a travelling signal) stops under reduced motion via globals.css.
 */

/** No incidents: a flat, calm heartbeat line with a healthy node at its end. */
export function QuietSignalArt() {
  return (
    <svg aria-hidden viewBox="0 0 168 72" className="h-[72px] w-[168px]" fill="none">
      <rect x="0.5" y="0.5" width="167" height="71" rx="12" fill="var(--surface-muted)" fillOpacity="0.5" stroke="var(--border)" />
      {[18, 36, 54].map((y) => (
        <path key={y} d={`M12 ${y} H156`} stroke="var(--border)" strokeWidth="1" />
      ))}
      <path d="M14 40 H58 l6 -12 l8 22 l6 -10 H140" stroke="var(--border-strong)" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M14 40 H58 l6 -12 l8 22 l6 -10 H140"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        className="hl-signal"
      />
      <circle cx="148" cy="40" r="6" fill="var(--ok-soft)" stroke="var(--ok)" strokeWidth="1.5" />
      <path d="M145.2 40.2 l1.9 1.9 3.6 -3.8" stroke="var(--ok)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Empty audit log: a stack of blank ledger rows waiting for the first entry. */
export function EmptyLedgerArt() {
  return (
    <svg aria-hidden viewBox="0 0 168 72" className="h-[72px] w-[168px]" fill="none">
      {[0, 1, 2].map((i) => (
        <g key={i} opacity={1 - i * 0.28}>
          <rect x={14 + i * 6} y={8 + i * 20} width={140 - i * 12} height="16" rx="5" fill="var(--surface)" stroke="var(--border-strong)" strokeOpacity="0.45" />
          <circle cx={26 + i * 6} cy={16 + i * 20} r="3" fill={i === 0 ? "var(--accent)" : "var(--border-strong)"} fillOpacity={i === 0 ? 1 : 0.5} />
          <rect x={36 + i * 6} y={14 + i * 20} width={52 - i * 8} height="4" rx="2" fill="var(--muted)" fillOpacity="0.35" />
          <rect x={112 - i * 6} y={14 + i * 20} width="28" height="4" rx="2" fill="var(--muted)" fillOpacity="0.2" />
        </g>
      ))}
    </svg>
  );
}

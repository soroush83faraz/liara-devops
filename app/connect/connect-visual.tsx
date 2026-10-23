import { ScanSearch, ShieldCheck, Waypoints, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

/*
 * The connect page's illustration: a tiny project map (gateway -> two apps -> one database) that draws itself in,
 * then keeps a health signal travelling along its links. Purely decorative (aria-hidden).
 * CSS-driven on purpose: it animates from the first paint (no wait for hydration), and under reduced motion every
 * animation jumps to its end state, leaving a still map (see .hl-draw / .hl-enter / .hl-signal in globals.css).
 */

type MapNode = { id: string; x: number; y: number; name: string; meta: string; tone: "accent" | "ok" };

const W = 148;
const H = 54;
const NODES: MapNode[] = [
  { id: "shop", x: 34, y: 112, name: "shop", meta: "node · 1 GB", tone: "accent" },
  { id: "api", x: 298, y: 112, name: "api", meta: "go · 512 MB", tone: "accent" },
  { id: "db", x: 166, y: 222, name: "shop-db", meta: "postgres", tone: "ok" },
];

// Links, drawn in order. Each also carries a travelling signal.
const EDGES = [
  { id: "gw-shop", d: "M240 58 C240 86 108 82 108 112" },
  { id: "gw-api", d: "M240 58 C240 86 372 82 372 112" },
  { id: "shop-db", d: "M108 166 C108 196 222 192 222 222" },
  { id: "api-db", d: "M372 166 C372 196 258 192 258 222" },
];

const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

export function TopologyIllustration({ className }: { className?: string }) {
  return (
    // Service names are LTR identifiers: the drawing is laid out left-to-right whatever the page direction.
    <svg aria-hidden viewBox="0 0 480 300" className={className} fill="none" style={{ direction: "ltr" }}>
      <defs>
        <radialGradient id="topo-glow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.09" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="480" height="300" fill="url(#topo-glow)" />

      {/* private network boundary */}
      <g className="hl-enter" style={delay(0.05)}>
        <rect x="14" y="94" width="452" height="196" rx="18" className="stroke-border-strong" strokeOpacity="0.5" strokeDasharray="4 6" />
        <rect x="30" y="85" width="74" height="18" rx="9" className="fill-background stroke-border" />
        <text x="67" y="97.5" textAnchor="middle" className="fill-muted font-mono" fontSize="10">
          network
        </text>
      </g>

      {EDGES.map((e, i) => (
        <g key={e.id}>
          <path
            d={e.d}
            pathLength={100}
            className="hl-draw stroke-border-strong"
            strokeWidth="1.5"
            strokeLinecap="round"
            style={delay(0.35 + i * 0.12)}
          />
          <path
            d={e.d}
            pathLength={100}
            className="hl-signal stroke-accent"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={delay(1.6 + i * 0.8)}
          />
        </g>
      ))}

      {/* gateway */}
      <g className="hl-enter" style={delay(0.15)}>
        <rect x="180" y="26" width="120" height="32" rx="16" className="fill-surface stroke-border-strong" strokeOpacity="0.7" />
        <circle cx="200" cy="42" r="7" className="stroke-accent" strokeWidth="1.4" />
        <path d="M193 42h14M200 35c-3 4-3 10 0 14M200 35c3 4 3 10 0 14" className="stroke-accent" strokeWidth="1.2" />
        <text x="252" y="46" textAnchor="middle" className="fill-foreground font-mono" fontSize="11.5">
          liara.run
        </text>
      </g>

      {NODES.map((n, i) => {
        const tile = n.tone === "ok" ? "fill-ok-soft" : "fill-accent-soft";
        const ink = n.tone === "ok" ? "stroke-ok" : "stroke-accent";
        const dot = n.tone === "ok" ? "fill-ok" : "fill-accent";
        return (
          <g key={n.id} className="hl-enter" style={delay(0.6 + i * 0.12)}>
            <rect x={n.x} y={n.y} width={W} height={H} rx="12" className="fill-surface stroke-border" />
            <rect x={n.x + 10} y={n.y + 12} width="30" height="30" rx="8" className={tile} />
            {n.id === "db" ? (
              <g className={ink} strokeWidth="1.3">
                <ellipse cx={n.x + 25} cy={n.y + 21} rx="7" ry="2.6" />
                <path
                  d={`M${n.x + 18} ${n.y + 21}v12c0 1.5 3 2.6 7 2.6s7-1.1 7-2.6V${n.y + 21}M${n.x + 18} ${n.y + 27}c0 1.5 3 2.6 7 2.6s7-1.1 7-2.6`}
                />
              </g>
            ) : (
              <g className={ink} strokeWidth="1.3">
                <rect x={n.x + 18} y={n.y + 19} width="14" height="6" rx="1.5" />
                <rect x={n.x + 18} y={n.y + 29} width="14" height="6" rx="1.5" />
              </g>
            )}
            <text x={n.x + 50} y={n.y + 25} className="fill-foreground font-mono" fontSize="12.5" fontWeight="600">
              {n.name}
            </text>
            <text x={n.x + 50} y={n.y + 41} className="fill-muted font-mono" fontSize="10">
              {n.meta}
            </text>
            <circle cx={n.x + W - 16} cy={n.y + 18} r="3.5" className={`hl-ping-svg ${dot}`} style={delay(1.2 + i * 0.7)} />
            <circle cx={n.x + W - 16} cy={n.y + 18} r="3.5" className={dot} />
          </g>
        );
      })}
    </svg>
  );
}

const BULLET_ICONS: LucideIcon[] = [Waypoints, ScanSearch, ShieldCheck];

/** The three promises as icon rows that reveal one after another. */
export function ConnectBullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {items.map((text, i) => {
        const Icon = BULLET_ICONS[i] ?? ShieldCheck;
        return (
          <li key={text} className="hl-enter flex items-start gap-3.5 text-[15px] leading-7" style={delay(0.45 + i * 0.12)}>
            <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-accent">
              <Icon className="size-[18px]" />
            </span>
            <span className="text-foreground/90">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

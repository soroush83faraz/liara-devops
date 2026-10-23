# Design direction — «اتاق سیگنال» (Signal Room)

Goal: the console should feel like a calm, precise instrument for watching infrastructure, not a generic slate-and-teal admin template.
This is a redesign of the visual language, layout and motion. **Behaviour, API routes, copy meaning and tests' accessible names stay the same.**

## What is wrong today (seen on localhost, 1024 px)

- Top bar is one crowded row (logo, 5 nav links, search, balance, bell, user); it wraps to two lines and nothing has a hierarchy.
- Opening a service panel **squeezes the canvas** into the remaining half, so the canvas toolbar wraps vertically and nodes are cropped.
- Minimap is huge, opaque and the same colour as the node cards; canvas background is flat navy.
- Nodes are tall cards with 5 lines of low-contrast text; status is a coloured word, not a visual signal.
- Everything is the same blue-grey, same radius, same weight; body line-height 1.9 makes dense UI loose.
- Almost no motion (three 140–200 ms keyframes), so state changes (probe result, route change, panel open) are invisible.

## Principles

1. **One signal colour, used sparingly.** Neutrals do the layout; the accent marks "live/primary/selected". Status colours (ok/warn/danger) mean status only.
2. **Layered surfaces, hairline borders.** Depth comes from 3 surface steps and 1 px low-alpha borders, not heavy shadows.
3. **Density with air.** UI text line-height 1.55 (prose in copilot/markdown stays 1.8), 4 px grid, tabular numerals for numbers.
4. **Motion explains.** Every animation answers "what just changed / where did it come from". 120–220 ms for feedback, spring for panels. Respect `prefers-reduced-motion` (use `<MotionConfig reducedMotion="user">`).
5. **RTL-first.** Use logical properties (`ms-*`, `ps-*`, `start/end`), mirror directional icons, keep LTR islands (`ltr-block`) for code/IDs.

## Tokens (replace values in `app/globals.css`, keep one token per line — `tests/unit/ui/contrast.test.ts` parses it; every fg/bg pair stays >= 4.5:1)

Dark (default look):
- background `#07090d`, surface `#0d1117`, surface-muted `#131922`, border `#1f2733`, border-strong `#4a586e`
- foreground `#e8edf4`, muted `#97a3b5`
- accent (signal) `#3ee0b0`, accent-foreground `#04140e`, accent-soft `#0b2a22`, accent-ink `#8ff2d3`
- ok `#4ade80`, warn `#f5b942`, danger `#ff6b6b` (+ their -soft/-ink)

Light:
- background `#f5f3ee`, surface `#ffffff`, surface-muted `#ece9e1`, border `#ddd8cc`, border-strong `#6b665a`
- foreground `#14171c`, muted `#555b66`
- accent `#0a7a5e`, accent-foreground `#ffffff`, accent-soft `#d9f2e9`, accent-ink `#075a45`

Add new tokens: `--radius-sm 8px / --radius-md 12px / --radius-lg 18px`, `--shadow-pop` (layered, low alpha), `--glow-accent` (0 0 0 1px accent/40%, 0 8px 32px accent/12%), `--grid-dot` for the canvas dot grid.
Type scale (Vazirmatn): 12 / 13 / 15 / 17 / 21 / 28, headings weight 700 with line-height 1.35, `font-variant-numeric: tabular-nums` on numbers.

## Layout

- **Desktop (>= 1024):** slim vertical **rail** on the inline-start edge (64 px, icons + tooltips; expands to 208 px with labels on hover/focus and pins via the existing shell store if one exists). Contains logo, نقشه / پایش / رخدادها / فعالیت‌ها / راه‌اندازی, and at the bottom the user menu. A **slim top bar** (52 px) holds: project/team name, command search (⌘K), balance chip (animated number), notifications.
- **Mobile (< 1024):** top bar with logo + search + menu; **bottom tab bar** with the 4–5 destinations.
- **Service panel = overlay drawer** from the inline-end edge: `width: min(560px, 100vw)`, spring in, dimmed (not blurred) canvas behind, closes on Esc / scrim click, **canvas never resizes**. On mobile it is a bottom sheet (existing behaviour may be reused). Tab strip uses a shared-layout animated underline (`layoutId`).
- Canvas toolbar is a **floating pill** pinned top-start inside the canvas, icon + label buttons that collapse to icons under 900 px.

## Canvas

- Dotted grid background (`--grid-dot`), subtle radial vignette.
- Node = compact card (≈ 220×96): type icon tile, name (bold), type·plan on one muted line, status as a **ring + pulsing dot** (running = accent pulse, stopped = hollow grey, failing = danger with soft glow), probe latency as a small chip when known. Selected node gets `--glow-accent` and a 1 px accent border. Hover lifts 2 px.
- Network groups: dashed hairline container with a small label chip, no heavy fill.
- Env edges: 1.5 px, animated dashed flow along the path (CSS `stroke-dashoffset` or motion), label chip small.
- Minimap: 140×96, translucent, bottom-start, nodes tinted by status; hidden on mobile.
- Entrance: nodes stagger in (opacity+8 px rise, 30 ms stagger, capped at 12 nodes).

## Motion kit (`lib/ui/motion.tsx`, dependency `motion`)

Export: `MotionProvider` (wraps `MotionConfig reducedMotion="user"`, mounted in `app/providers.tsx`), presets `spring.panel`, `spring.pop`, `ease.out`, variants `fadeUp`, `stagger`, components `FadeIn`, `Stagger`, `AnimatedNumber` (tweens balance/price, tabular-nums), `Pulse` (status dot), `Skeleton` (shimmer via CSS). Page transitions are a short fade/rise on route content only (never block navigation). Prefer `transform`/`opacity`; no layout-thrashing animations on the canvas itself.

## Connect page (`/connect`)

Two columns on desktop: left the form on a glass/solid surface card with the logo, right an **animated topology illustration** (3–4 nodes drawing connections, a health pulse travelling along an edge, loops slowly; static under reduced motion). Headline stays the same text. The three bullets become icon rows that reveal in sequence. The "how do I make a key" disclosure animates height. The submit button has a loading state with a progress sweep and the error appears with a small shake (reduced-motion: none).

## Do not

- Do not change API routes, store shapes, or copy meaning. Keep `aria-label`s, roles, `data-testid`s and visible Persian strings that `tests/e2e` and `tests/unit` assert on (grep before renaming anything).
- Do not add a UI kit; Radix primitives and Tailwind v4 stay. `motion` is the only new dependency.
- Do not use gradients as text fill or glassmorphism everywhere; one tasteful use (connect card) is enough.

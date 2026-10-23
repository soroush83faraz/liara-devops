"use client";

/**
 * Motion kit («اتاق سیگنال»). Every animation answers "what just changed / where did it come from".
 * Feedback 120–220 ms, springs for panels; transform/opacity only. `MotionProvider` (mounted in app/providers.tsx)
 * makes every `motion.*` element honour prefers-reduced-motion; CSS animations are switched off in globals.css.
 *
 *   <FadeIn delay={0.1}>…</FadeIn>
 *   <Stagger className="flex flex-col gap-2">{items.map((i) => <StaggerItem key={i.id}>…</StaggerItem>)}</Stagger>
 *   <AnimatedNumber value={balance} format={faPrice} />
 *   <Pulse tone="accent" />            // live status dot
 *   <Skeleton className="h-4 w-32" />  // shimmer placeholder
 */
import {
  MotionConfig,
  animate,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
  type Variants,
} from "motion/react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { faNumber } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

export { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Spring presets: `panel` for drawers/sheets (no overshoot you can see), `pop` for small surfaces and chips. */
export const spring = {
  panel: { type: "spring", stiffness: 380, damping: 38, mass: 0.9 },
  pop: { type: "spring", stiffness: 560, damping: 32, mass: 0.7 },
} satisfies Record<string, Transition>;

/** Easing curves (exponential ease-out reads as "settling", never as "bouncing"). */
export const ease = {
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

export const duration = { fast: 0.14, base: 0.22, slow: 0.42 } as const;

/** Rise 8 px while fading in. Use with `initial="hidden" animate="show"` (or inside <Stagger>). */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: duration.slow, ease: ease.out } },
};

/** Container variants that reveal children one after another. */
export function stagger(step = 0.03, delayChildren = 0): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: step, delayChildren } },
  };
}

type DivMotionProps = Omit<HTMLMotionProps<"div">, "initial" | "animate" | "variants">;

/** Fades + rises its content in once, on mount. */
export function FadeIn({ delay = 0, y = 8, className, children, ...props }: DivMotionProps & { delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.slow, ease: ease.out, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Reveals <StaggerItem> children in sequence. `as="ul"` renders a list (items then render <li>). */
export function Stagger({
  step = 0.06,
  delay = 0,
  as = "div",
  className,
  children,
}: {
  step?: number;
  delay?: number;
  as?: "div" | "ul" | "ol";
  className?: string;
  children: ReactNode;
}) {
  const Comp = as === "ul" ? motion.ul : as === "ol" ? motion.ol : motion.div;
  return (
    <Comp initial="hidden" animate="show" variants={stagger(step, delay)} className={className}>
      {children}
    </Comp>
  );
}

export function StaggerItem({ as = "div", className, children }: { as?: "div" | "li"; className?: string; children: ReactNode }) {
  const Comp = as === "li" ? motion.li : motion.div;
  return (
    <Comp variants={fadeUp} className={className}>
      {children}
    </Comp>
  );
}

/**
 * A number that tweens to its new value (balance, price). The DOM text is updated directly, so the element only ever
 * contains one formatted number (tests and screen readers read the final value as soon as it settles).
 * `countUp` animates from zero on mount; otherwise only later changes animate.
 */
export function AnimatedNumber({
  value,
  format = (n: number) => faNumber(Math.round(n)),
  countUp = false,
  durationS = 0.7,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  countUp?: boolean;
  durationS?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number>(countUp ? 0 : value);
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  useEffect(() => {
    formatRef.current = format;
  });

  // Before first paint: start from zero when counting up, so the final value never flashes first.
  useLayoutEffect(() => {
    if (ref.current && countUp && !reduce) ref.current.textContent = formatRef.current(shown.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    if (reduce || from === value) {
      shown.current = value;
      el.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(from, value, {
      duration: durationS,
      ease: ease.out,
      onUpdate: (n) => {
        shown.current = n;
        el.textContent = formatRef.current(n);
      },
      onComplete: () => {
        shown.current = value;
        el.textContent = formatRef.current(value);
      },
    });
    return () => controls.stop();
  }, [value, reduce, durationS]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)} data-numeric>
      {format(value)}
    </span>
  );
}

const pulseTone = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  muted: "bg-muted",
} as const;

/**
 * Status dot. `active` adds an expanding ring (live/running/failing); `hollow` draws an outlined dot (stopped).
 * Decorative: pair it with a text label, colour alone never carries meaning.
 */
export function Pulse({
  tone = "accent",
  active = true,
  hollow = false,
  className,
}: {
  tone?: keyof typeof pulseTone;
  active?: boolean;
  hollow?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("relative inline-flex size-2 shrink-0", className)}>
      {active && !hollow ? <span className={cn("absolute inset-0 rounded-full animate-hl-ping", pulseTone[tone])} /> : null}
      <span
        className={cn(
          "relative inline-flex size-full rounded-full",
          hollow ? "border-[1.5px] border-muted bg-transparent" : pulseTone[tone],
        )}
      />
    </span>
  );
}

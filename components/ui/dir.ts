/** The product is Persian-only, so Radix primitives (which default to "ltr") are always told "rtl". */
export const DIR = "rtl" as const;

/** Add to directional icons (chevrons, arrows) so they mirror in RTL. */
export const flipRtl = "rtl:-scale-x-100";

/**
 * Direction for a field whose typed value is LTR (tokens, regexes, hostnames) but whose placeholder is Persian:
 * an empty field is RTL so the placeholder starts on the right and its ellipsis ends on the left; as soon as
 * there is text the field switches to `filled` ("ltr" for code-like values, "auto" for prose).
 */
export const emptyAwareDir = (value: string, filled: "ltr" | "auto" = "auto", placeholder?: string): "rtl" | "ltr" | "auto" =>
  value || (placeholder !== undefined && !isPersian(placeholder)) ? filled : DIR;

/** True when the text contains Persian/Arabic letters (a Latin example placeholder keeps the field LTR). */
export const isPersian = (text: string | undefined): boolean => !!text && /[\u0600-\u06FF]/.test(text);

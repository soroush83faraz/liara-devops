// Clipboard write with a legacy fallback (insecure contexts, denied permission). Returns whether it worked.
// Text from t() carries invisible bidi isolates (U+2066..U+2069) that help rendering but corrupt pasted commands,
// names and URLs, so every copy path goes through `clipboardText`.
import { stripIsolates } from "@/lib/i18n/bidi";

/** What actually lands on the clipboard: the visible text, without display-only bidi isolates. */
export const clipboardText = (text: string): string => stripIsolates(text);

export async function copyToClipboard(text: string): Promise<boolean> {
  const clean = clipboardText(text);
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(clean);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const el = document.createElement("textarea");
    el.value = clean;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

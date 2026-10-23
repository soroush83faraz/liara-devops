// Keyboard rules for the composer, kept pure so IME handling is testable.
export interface EnterKeyEvent {
  key: string;
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** Set while an IME (Persian/Arabic/CJK keyboards, mobile composition) is mid-composition. */
  isComposing?: boolean;
  /** Legacy IME marker: browsers report 229 for keydown during/just after composition (Safari). */
  keyCode?: number;
}

/** Enter sends; Shift+Enter inserts a newline; Enter that confirms an IME composition must NOT send. */
export function shouldSubmitOnEnter(e: EnterKeyEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.shiftKey || e.altKey) return false;
  return true;
}

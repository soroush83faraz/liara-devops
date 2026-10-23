// Copy for the error/not-found safety nets lives in the dictionary (lib/i18n/ns/deployErrors.ts); re-exported
// here so the existing imports keep working. Server error messages and stack traces are never shown.
import { fa } from "@/lib/i18n/fa";

export const faErrors = fa.deployErrors;

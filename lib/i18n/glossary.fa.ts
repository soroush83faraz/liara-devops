// Fixed Persian terminology. Use in UI strings and in the system prompt so wording stays consistent.
export const glossary = {
  deploy: "انتشار نسخه",
  release: "نسخه",
  restart: "راه‌اندازی مجدد",
  "environment variable": "متغیر محیطی",
  logs: "لاگ‌ها",
  health: "سلامت",
  evidence: "شواهد",
} as const;

export type GlossaryKey = keyof typeof glossary;

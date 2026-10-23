// Development-only copy for the copilot mock. Deliberately NOT part of the `fa` dictionary: it is imported only
// behind `process.env.NODE_ENV !== "production"` checks, so it is dropped from production bundles
// (a build-output grep for these strings must find nothing).
export const devMock = {
  /** Persistent label on mock incidents and cards. */
  dataBadge: "داده‌ی نمونه (حالت آزمایشی)",
  mockBadge: "حالت آزمایشی (داده‌ی ساختگی)",
  mockNote: "پاسخ‌ها ساختگی‌اند و به لیارا وصل نیستند.",
  scenarioLabel: "سناریوی آزمایشی",
  scenarios: {
    auto: "خودکار",
    s1: "خطای ۵۰۰ با شواهد قوی",
    healthy: "سرویس سالم",
    insufficient: "اطلاعات ناکافی",
    partial: "خطای بخشی از منابع",
    llm_down: "هوش مصنوعی در دسترس نیست",
    not_verified: "اجرا شد اما تأیید نشد",
    injection: "خط لاگ مشکوک به دستور مخرب",
    declined: "درخواست ردشده",
    stale: "پیشنهاد کهنه",
  },
} as const;

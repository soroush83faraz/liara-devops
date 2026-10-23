// Persian copy for the error/not-found safety nets. Add keys here only; do not edit lib/i18n/fa.ts.
// Server error messages and stack traces are never shown; only the opaque digest as a support reference.
export const deployErrors = {
  appName: "همیار لیارا",
  notFound: {
    code: "404",
    title: "این صفحه پیدا نشد",
    description: "نشانی را اشتباه وارد کرده‌اید یا این صفحه دیگر وجود ندارد.",
    home: "بازگشت به صفحه اصلی",
  },
  error: {
    title: "مشکلی پیش آمد",
    description: "درخواست شما به نتیجه نرسید. دوباره تلاش کنید و پیش از تکرار کارهای حساس، وضعیت را در صفحه فعالیت‌ها بررسی کنید. اگر مشکل ادامه داشت، چند دقیقه بعد سر بزنید.",
    retry: "تلاش دوباره",
    home: "بازگشت به صفحه اصلی",
    reference: "کد پیگیری",
  },
  globalError: {
    title: "همیار لیارا در دسترس نیست",
    description: "برنامه نتوانست بارگذاری شود. صفحه را دوباره بارگذاری کنید.",
    retry: "تلاش دوباره",
  },
} as const;

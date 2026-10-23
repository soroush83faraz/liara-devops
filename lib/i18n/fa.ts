import { canvasMap } from "./ns/canvasMap";
import { appOps } from "./ns/appOps";
import { appConfig } from "./ns/appConfig";
import { dbPanel } from "./ns/dbPanel";
import { createFlow } from "./ns/createFlow";
import { copilotUi } from "./ns/copilotUi";
import { setupFlow } from "./ns/setupFlow";
import { activity } from "./ns/activity";
import { actionsMsg } from "./ns/actionsMsg";
import { deployErrors } from "./ns/deployErrors";
import { observability } from "./ns/observability";
// Persian UI dictionary. This is the ONLY place user-facing Persian strings live.
// Tone: friendly-formal (شما). Terminology comes from ./glossary.fa so UI and agent prompt agree.
// Placeholders use {name}; numbers passed to t() are formatted with Persian digits automatically.
import { isolateLatin } from "./bidi";
import { glossary } from "./glossary.fa";

const dictionary = {
  common: {
    appName: "همیار لیارا",
    appDescription: "دستیار عیب‌یابی و رفع حادثه برای سایت‌های میزبانی‌شده روی لیارا",
    tagline: "هر چیزی که روی لیارا داری، یک‌جا ببین، مدیریت کن و با کمک هوش مصنوعی عیب‌یابی کن.",
    skipToContent: "رفتن به محتوای اصلی",
    loading: "در حال بارگذاری…",
    close: "بستن",
    cancel: "انصراف",
    confirm: "تأیید",
    save: "ذخیره",
    saving: "در حال ذخیره…",
    retry: "تلاش دوباره",
    back: "بازگشت",
    next: "بعدی",
    copy: "کپی",
    copied: "کپی شد",
    copyFailed: "کپی انجام نشد",
    show: "نمایش",
    hide: "پنهان کردن",
    delete: "حذف",
    edit: "ویرایش",
    add: "افزودن",
    search: "جستجو",
    more: "بیشتر",
    details: "جزئیات",
    none: "ندارد",
    unknown: "نامشخص",
    yes: "بله",
    no: "خیر",
    optional: "اختیاری",
    required: "الزامی",
    dash: "—",
    toast: "اعلان‌ها",
    dismiss: "بستن اعلان",
    resize: "تغییر اندازه",
    toman: "تومان",
    perMonth: "در ماه",
    perHour: "در ساعت",
    theme: "پوسته",
    ok: "باشه",
    justNow: "همین الان",
  },

  connect: {
    title: "اتصال به لیارا",
    headline: "مشکل سایتت رو بگو، بقیه‌اش با ما",
    lead: "کلید API لیارای خود را وارد کنید تا سرویس‌هایتان را یک‌جا ببینید و عیب‌یابی کنید.",
    bullets: {
      one: "همه‌ی سرویس‌های شما روی لیارا، از اپ و دیتابیس تا شبکه، در یک نقشه‌ی ساده دیده می‌شود.",
      two: "همیار لاگ‌ها و وضعیت سرویس را می‌خواند، دلیل مشکل را با شواهد توضیح می‌دهد و راه‌حل پیشنهاد می‌کند.",
      three: "هیچ تغییری بدون تأیید خودتان انجام نمی‌شود و پیش از هر کار، اثر و هزینه‌اش را می‌بینید.",
    },
    tokenLabel: "کلید API لیارا",
    tokenPlaceholder: "کلید را اینجا جای‌گذاری کنید",
    tokenHint: "کلید را از کنسول لیارا بسازید و اینجا بچسبانید.",
    showToken: "نمایش کلید",
    hideToken: "پنهان کردن کلید",
    teamLabel: "شناسه‌ی تیم",
    teamHint: "فقط اگر سرویس‌هایتان زیر یک تیم است وارد کنید.",
    teamPlaceholder: "مثلاً 5f3a9c…",
    submit: "اتصال",
    submitting: "در حال بررسی کلید…",
    help: {
      toggle: "کلید API را از کجا بسازم؟",
      step1Before: "به",
      step1After: "بروید و وارد حساب خود شوید.",
      step2: "از منوی «API» وارد بخش کلیدها شوید.",
      step3: "مدت اعتبار کوتاه (مثلاً یک روز) را انتخاب کنید.",
      step4: "روی «ساخت کلید جدید» بزنید و کلید را کپی کنید.",
      tip: "بعد از پایان کار، کلید را در کنسول لیارا حذف کنید.",
    },
    safety: "کلید فقط روی سرور ذخیره می‌شود و هرگز به مدل هوش مصنوعی ارسال نمی‌شود.",
    errors: {
      tokenRequired: "کلید API را وارد کنید.",
      tokenInvalidFormat: "قالب کلید درست نیست. مطمئن شوید همه‌ی کلید را بدون فاصله کپی کرده‌اید.",
      teamInvalidFormat: "شناسه‌ی تیم فقط می‌تواند شامل حروف انگلیسی، عدد، خط تیره و زیرخط باشد.",
    },
    connected: "اتصال برقرار شد",
  },

  shell: {
    logoLabel: "همیار لیارا، صفحه‌ی اصلی",
    mainNav: "ناوبری اصلی",
    projectSwitcher: "انتخاب پروژه",
    healthWatch: "پایش سلامت",
    balance: "اعتبار حساب",
    teamBalance: "اعتبار تیم",
    teamBalanceUnreadable: "اعتبار این تیم از لیارا خوانده نشد",
    team: "تیم",
    account: "حساب کاربری",
    accountMenu: "منوی حساب",
    mobileMenu: "منوی صفحه‌ها",
    signedInAs: "واردشده با",
    disconnect: "قطع اتصال",
    disconnecting: "در حال قطع اتصال…",
    disconnectFailed: "قطع اتصال انجام نشد. دوباره تلاش کنید.",
    nav: {
      canvas: "بوم پروژه",
      setup: "راه‌اندازی",
      incidents: "رخدادها",
      activity: "فعالیت‌ها",
    },
    servicePanel: "پنل سرویس",
    closePanel: "بستن پنل",
    resizePanel: "تغییر عرض پنل",
    placeholderTitle: "بوم پروژه به‌زودی اینجاست",
    placeholderBody: "اتصال شما برقرار است. نقشه‌ی سرویس‌ها و دستیار همیار در گام‌های بعدی به این صفحه اضافه می‌شود.",
    placeholderCta: "بررسی اجزای رابط",
  },

  /** Screen-reader text the canvas library would otherwise read out in English. */
  a11y: {
    nodeDescription: "برای انتخاب سرویس Enter یا Space بزنید؛ سپس با کلیدهای جهت‌نما آن را جابه‌جا کنید و با Escape انصراف دهید.",
    nodeDescriptionKeyboardDisabled: "برای انتخاب سرویس Enter یا Space بزنید و با Escape انصراف دهید.",
    nodeMoved: "سرویس انتخاب‌شده به سمت {direction} رفت. جای تازه: افقی {x}، عمودی {y}",
    edgeDescription: "برای انتخاب پیوند Enter یا Space بزنید و با Escape انصراف دهید.",
    handle: "نقطه‌ی اتصال",
    directionUp: "بالا",
    directionDown: "پایین",
    directionLeft: "چپ",
    directionRight: "راست",
  },

  status: {
    running: "در حال اجرا",
    stopped: "متوقف",
    building: "در حال ساخت",
    failed: "ناموفق",
    unhealthy: "ناسالم",
    unknown: "نامشخص",
    healthy: "سالم",
    degraded: "کند یا ناپایدار",
    label: "وضعیت",
  },

  errors: {
    generic: "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
    unauthorized: "کلید معتبر نیست یا منقضی شده",
    unauthorizedReconnect: "نشست شما پایان یافته است. دوباره به لیارا متصل شوید.",
    forbidden: "دسترسی لازم برای این کار را ندارید.",
    notFound: "پیدا نشد.",
    conflict: "عملیات دیگری در حال انجام است. کمی بعد دوباره تلاش کنید.",
    rateLimited: "تعداد درخواست‌ها زیاد بود. کمی صبر کنید و دوباره امتحان کنید.",
    rateLimitedCountdown: "تعداد درخواست‌ها زیاد بود. {seconds} ثانیه‌ی دیگر دوباره تلاش کنید.",
    liaraTimeout: "لیارا پاسخ نداد",
    liaraUnavailable: "لیارا در حال حاضر در دسترس نیست",
    liaraBadResponse: "پاسخ لیارا قابل‌فهم نبود",
    network: "اتصال به اینترنت برقرار نیست یا سرور در دسترس نیست.",
    badRequest: "درخواست نامعتبر بود.",
    forbiddenOrigin: "این درخواست از مبدأ مجاز ارسال نشده است.",
    teamForbidden: "این کلید به تیم واردشده دسترسی ندارد.",
    incompleteEvidence: "شواهد کامل نیست؛ بخشی از داده‌ها در دسترس نبود.",
    neverFabricated: "داده‌ای نمایش داده نمی‌شود، چون نمی‌خواهیم چیزی را حدسی نشان دهیم.",
    loadFailed: "بارگذاری انجام نشد",
  },

  canvas: {
    title: "نقشه‌ی پروژه",
    listView: "نمای فهرست",
    canvasView: "نمای نقشه",
    noNetwork: "بدون شبکه",
    emptyTitle: "هنوز سرویسی ندارید",
    emptyBody: "اولین اپ یا دیتابیس خود را بسازید یا از دستیار راه‌اندازی کمک بگیرید.",
    investigate: "بررسی با همیار",
    lastDeploy: "آخرین انتشار",
    viaVariable: "از طریق متغیر {name}",
  },

  service: {
    app: "اپ",
    database: "دیتابیس",
    network: "شبکه",
    tabs: {
      copilot: "همیار",
      overview: "نمای کلی",
      releases: "نسخه‌ها",
      logs: glossary.logs,
      resources: "منابع",
      variables: "متغیرها",
      domains: "دامنه‌ها",
      disks: "دیسک‌ها",
      settings: "تنظیمات",
      backups: "پشتیبان‌گیری",
      events: "رویدادها",
    },
    restart: glossary.restart,
    envVars: glossary["environment variable"],
  },

  create: {
    newApp: "اپ جدید",
    newDatabase: "دیتابیس جدید",
    newNetwork: "شبکه‌ی جدید",
    costLine: "هزینه: {hourly} در ساعت، حدود {monthly} در ماه",
    typeNameToConfirm: "برای ادامه، نام منبع را تایپ کنید",
  },

  copilot: {
    name: "همیار",
    placeholder: "مشکل را بنویسید یا بپرسید…",
    send: "ارسال",
    observed: "مشاهده‌شده",
    inferred: "برداشت",
    unclear: "نامشخص",
    evidenceLevel: {
      strong: "قوی",
      medium: "متوسط",
      weak: "ضعیف",
    },
    evidence: glossary.evidence,
  },

  approval: {
    title: "تأیید عملیات",
    operation: "عملیات",
    target: "هدف",
    reason: "دلیل",
    expectedEffect: "اثر مورد انتظار",
    risks: "ریسک‌ها",
    reversibility: "قابل بازگشت بودن",
    reversible: "قابل بازگشت",
    irreversible: "غیرقابل بازگشت",
    cost: "هزینه",
    noCost: "بدون هزینه‌ی اضافه",
    verificationPlan: "برنامه‌ی راستی‌آزمایی",
    apiCall: "فراخوانی دقیق API",
    approve: "تأیید و اجرا",
    reject: "رد کردن",
    executing: "در حال اجرا…",
    stale: "وضعیت سرویس تغییر کرده است. پیش از ادامه، دوباره بررسی کنید.",
    tier: {
      one: "تأیید ساده",
      two: "تأیید با هزینه و نام منبع",
      three: "فقط توسط شما، با هشدار",
    },
    typeNameTitle: "نام منبع را تایپ کنید",
    typeNameDescription: "برای جلوگیری از اشتباه، نام دقیق منبع را در کادر زیر وارد کنید:",
    typeNameLabel: "نام منبع",
    typeNameMismatch: "نام با منبع هدف یکی نیست.",
    typeNameMatch: "نام مطابقت دارد.",
    dangerWarning: "این کار قابل بازگشت نیست.",
    confirmFailed: "عملیات انجام نشد. دوباره تلاش کنید.",
  },

  incidents: {
    title: "حادثه‌ها",
    empty: "هنوز حادثه‌ای ثبت نشده است.",
    copyMarkdown: "کپی گزارش (Markdown)",
    activity: "فعالیت‌ها",
  },

  setup: {
    title: "دستیار راه‌اندازی",
    upload: "بارگذاری فایل zip پروژه",
    describe: "پروژه‌ی خود را توضیح دهید",
  },

  kit: {
    title: "اجزای رابط کاربری",
    note: "این صفحه فقط برای بررسی ظاهری در محیط توسعه است.",
  },

  canvasMap,
  appOps,
  appConfig,
  dbPanel,
  createFlow,
  copilotUi,
  setupFlow,
  activity,
  actionsMsg,
  deployErrors,
  observability,
} as const;

export type FaDict = typeof dictionary;

function isolateDeep<T>(node: T): T {
  if (typeof node === "string") return isolateLatin(node) as T;
  // Arrays must stay arrays (callers spread/iterate them, e.g. proposal risks); only plain objects are rebuilt.
  if (Array.isArray(node)) return node.map((v) => isolateDeep(v)) as T;
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, isolateDeep(v)])) as T;
  }
  return node;
}

/** The dictionary every call site reads: Latin/code fragments in Persian strings are bidi-isolated once, here. */
export const fa: FaDict = isolateDeep(dictionary);

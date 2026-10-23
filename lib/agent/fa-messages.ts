// UI-visible Persian produced by the agent (step labels, banners, answer scaffolding, proposal texts).
// The system prompt lives in ./prompts.fa.ts. Terminology comes from the shared glossary.
import { statusCode } from "@/lib/i18n/bidi";
import { glossary } from "@/lib/i18n/glossary.fa";
import type { EvidenceLevel } from "@/lib/contracts/hypothesis";
import type { SourceName } from "@/lib/evidence/types";

const ENV = glossary["environment variable"];
const RESTART = glossary.restart;
const RELEASE = glossary.release;
const DEPLOY = glossary.deploy;
const LOGS = glossary.logs;

export const STEP_LABEL_FA = {
  intent: "تشخیص درخواست",
  target: "شناسایی سرویس",
  collect: "جمع‌آوری شواهد",
  pass2: "بررسی تکمیلی",
  synthesis: "تحلیل و جمع‌بندی",
  proposal: "پیشنهاد اقدام",
  incident: "ثبت گزارش حادثه",
} as const;

export const SOURCE_LABEL_FA: Record<SourceName, string> = {
  app: "جزئیات برنامه",
  applets: "وضعیت کانتینرها",
  releases: `فهرست ${RELEASE}‌ها`,
  release_detail: `جزئیات آخرین ${RELEASE}`,
  build_logs: `${LOGS} ساخت`,
  events: "رویدادها",
  runtime_logs: `${LOGS} اجرا`,
  metrics_summary: "مصرف فعلی منابع",
  metrics_series: "روند مصرف منابع",
  probe: "بررسی سلامت آدرس",
  plan: "مشخصات پلن",
  databases: "فهرست پایگاه‌های داده",
  db_detail: "جزئیات پایگاه داده",
  db_list: "فهرست پایگاه‌های داده",
  db_metrics: "مصرف منابع پایگاه داده",
  db_events: "رویدادهای پایگاه داده",
};

export const TOOL_LABEL_FA: Record<string, string> = {
  get_app_status: "خواندن وضعیت برنامه",
  get_applets: "خواندن وضعیت کانتینرها",
  list_releases: `خواندن فهرست ${RELEASE}‌ها`,
  get_release: `خواندن جزئیات ${RELEASE}`,
  get_runtime_logs: `خواندن ${LOGS} اجرا`,
  get_build_logs: `خواندن ${LOGS} ساخت`,
  get_events: "خواندن رویدادها",
  get_metrics: "خواندن مصرف منابع",
  probe_site: "بررسی سلامت آدرس",
  get_db_status: "خواندن وضعیت پایگاه داده",
  get_db_metrics: "خواندن مصرف منابع پایگاه داده",
  propose_action: "ثبت پیشنهاد مدل (فقط اعتبارسنجی)",
};

export const ERROR_FA = {
  llm_unavailable: "توضیح هوشمند در دسترس نیست؛ این شواهد پیدا شد.",
  evidence_partial: "بخشی از شواهد دریافت نشد؛ نتیجه بر اساس شواهد ناقص است.",
  rate_limited: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.",
  too_many_runs: "یک بررسی دیگر برای حساب شما در حال انجام است؛ لطفاً تا پایان آن صبر کنید.",
  bad_request: "درخواست نامعتبر است.",
  target_not_found: "این سرویس در حساب شما پیدا نشد.",
  internal: "بررسی با خطای غیرمنتظره متوقف شد. دوباره تلاش کنید.",
  aborted: "بررسی متوقف شد.",
  proposal_failed: "ساخت پیشنهاد اقدام ممکن نشد؛ وضعیت فعلی سرویس خوانده نشد.",
  incident_failed: "ثبت گزارش حادثه انجام نشد.",
} as const;

export const LEVEL_FA: Record<EvidenceLevel, string> = {
  strong: "قوی",
  medium: "متوسط",
  weak: "ضعیف",
  insufficient: "ناکافی",
};

export const ANSWER_FA = {
  observed: "مشاهده‌شده:",
  inferred: "برداشت:",
  unknown: "نامشخص:",
  hypothesisLine: "{title} (سطح شواهد: {level}؛ {ids})",
  idSeparator: "، ",
  noFacts: "شاهد مشخصی از خطا ثبت نشد.",
  noHypothesis: "با شواهد فعلی نمی‌توان علت مشخصی را برداشت کرد.",
  noUnknowns: "مورد مهمی نامشخص نماند.",
  ruleOnlyHeadline: "این جمع‌بندی بر اساس قواعد ثابت و شواهد جمع‌آوری‌شده است.",
  healthyHeadline: "در شواهد بررسی‌شده نشانه‌ای از خطا دیده نشد.",
  /** Built by code from the validated top finding; never model prose. */
  topHeadline: "محتمل‌ترین برداشت: {title} (سطح شواهد: {level}). این یک فرضیه است، نه علت قطعی.",
  errorsNoCauseHeadline: "نشانه‌هایی از خطا دیده شد، اما با شواهد فعلی علت مشخصی برداشت نشد.",
  allFailedHeadline: "نتوانستیم شواهدی جمع کنیم: هیچ‌یک از منابع شواهد پاسخ نداد، پس دربارهٔ سلامت سرویس یا علت مشکل چیزی نمی‌توان گفت.",
  allFailedNote: "همهٔ منابع شواهد ناموفق بودند؛ هیچ نتیجه‌ای دربارهٔ سلامت یا علت مشکل گرفته نشد.",
  noFactsAllFailed: "هیچ شاهدی دریافت نشد.",
  modelSummaryTitle: "خلاصه‌ی مدل (برداشت):",
  modelSummaryNote: "این بخش را مدل زبانی نوشته است؛ برداشت است، نه شاهد.",
  modelFiltered: "{count} جمله از متن مدل که ادعای قطعیت یا اقدامی خارج از پیشنهاد بررسی‌شده داشت حذف شد.",
  modelExtra: "توضیح تکمیلی مدل (برداشت):",
  partialNote: "بخشی از منابع شواهد در دسترس نبود؛ نتیجه ممکن است ناقص باشد.",
  flaggedNote: "{count} خط از لاگ‌ها شبیه دستور به دستیار بود؛ به‌عنوان داده نگه داشته شد و هیچ اقدامی بر اساس آن انجام نشد.",
  hypothesisNote: "این‌ها فرضیه‌اند، نه علت قطعی.",
  proposal: "پیشنهاد اقدام (فقط با تأیید شما اجرا می‌شود): {effect}",
  noProposal: "اقدام خودکاری پیشنهاد نمی‌شود.",
  developerTitle: "آنچه توسعه‌دهنده باید اصلاح کند:",
  developerRestart: `${RESTART} این مشکل را حل نمی‌کند، چون خطا در کد یا فرایند ساخت است.`,
  restartWontHelp: `شواهد نشان می‌دهد ${RESTART} مشکل را حل نمی‌کند؛ بنابراین ${RESTART} پیشنهاد نشد.`,
  betterAction: "به جای اقدام درخواستی، اقدام زیر با شواهد سازگارتر است.",
  requestedNotProposable: "این اقدام را دستیار پیشنهاد نمی‌دهد؛ می‌توانید از بخش مربوط در پنل سرویس آن را انجام دهید.",
  resizeNoPlan: "پلن بزرگ‌تری که قیمتش مشخص باشد پیدا نشد؛ ارتقای پلن پیشنهاد نشد.",
  noEvidenceForAction: "شواهد کافی برای پیشنهاد این اقدام وجود ندارد.",
  collectMoreEvidence: "شواهد فعلی ضعیف است و اقدامی پیشنهاد نشد. برای شواهد بیشتر: یک دقیقه دیگر دوباره بررسی کنید و اگر برنامه وب است ثبت لاگ درخواست‌ها (access log) همراه با زمان پاسخ را فعال کنید.",
  limits: "محدودیت‌ها:",
} as const;

export const REFUSE_FA = {
  destructive:
    "دستیار نمی‌تواند چیزی را حذف کند. حذف برنامه، پایگاه داده، دامنه یا دیسک فقط از تنظیمات همان سرویس و با تایپ نام آن توسط خود شما ممکن است.",
  shell:
    "دستیار به ترمینال یا اجرای دستور روی سرور دسترسی ندارد و چنین کاری انجام نمی‌دهد. می‌توانم با خواندن لاگ‌ها و وضعیت سرویس مشکل را بررسی کنم و اقدام امن پیشنهاد بدهم.",
  crossApp: "دستیار فقط روی سرویس‌های حساب خودتان کار می‌کند.",
  generic: "این درخواست خارج از کارهایی است که دستیار انجام می‌دهد.",
} as const;

export const CLARIFY_FA = {
  question: "منظورتان را دقیق‌تر بگویید: مثلاً «چرا سایت shop خطای ۵۰۰ می‌دهد؟» یا «وضعیت برنامه shop چطور است؟»",
  whichTarget: "کدام سرویس را بررسی کنم؟ نام برنامه یا پایگاه داده را بنویسید یا آن را روی نقشه انتخاب کنید.",
  ambiguousTarget: "چند سرویس با این توضیح پیدا شد ({names})؛ کدام را بررسی کنم؟",
  noResources: "هیچ برنامه یا پایگاه داده‌ای در حساب شما پیدا نشد.",
} as const;

export const SETUP_REDIRECT_FA =
  `برای ${DEPLOY} یک پروژه جدید از دستیار راه‌اندازی (صفحه /setup) استفاده کنید؛ آنجا فایل پروژه را بررسی می‌کنم و برنامه مناسب را با هزینه مشخص پیشنهاد می‌دهم.`;

export const EXPLAIN_FALLBACK_FA = "برای توضیح مفاهیم، دستیار هوشمند لازم است که اکنون در دسترس نیست.";

/** Proposal texts. Built by code, never by the model. */
export const PROPOSAL_FA = {
  restart: {
    rationale: `شواهد نشانه‌ای از خطای کد یا تنظیمات نشان نمی‌دهد و مشکل گذرا به نظر می‌رسد؛ ${RESTART} معمولاً چنین وضعیتی را برطرف می‌کند.`,
    rationaleRequested: `به درخواست شما ${RESTART} پیشنهاد شد؛ شواهد مخالفی برای آن پیدا نشد.`,
    effect: `برنامه {app} ${RESTART} می‌شود.`,
    risks: ["چند ثانیه تا چند ده ثانیه سایت در دسترس نخواهد بود.", "اگر علت مشکل در کد باشد، پس از راه‌اندازی دوباره تکرار می‌شود."],
  },
  set_env: {
    rationale: `برنامه در ${LOGS} اعلام کرده ${ENV} {key} وجود ندارد و این کلید در تنظیمات برنامه تعریف نشده است.`,
    effectGenerated: `${ENV} {key} با یک مقدار تصادفی امن که روی سرور ساخته می‌شود تنظیم و برنامه ${RESTART} می‌شود.`,
    effectUser: `${ENV} {key} با مقداری که شما هنگام تأیید وارد می‌کنید تنظیم و برنامه ${RESTART} می‌شود.`,
    risks: [`تغییر ${ENV} باعث ${RESTART} برنامه می‌شود.`, "اگر برنامه به مقدار خاصی نیاز دارد، مقدار اشتباه می‌تواند خطای دیگری ایجاد کند."],
  },
  update_port: {
    rationale: "برنامه روی پورت {listenPort} اجرا شده اما پورت تنظیم‌شده در لیارا {configuredPort} است.",
    effect: "پورت برنامه {app} در لیارا روی {port} تنظیم می‌شود.",
    risks: [`تغییر پورت باعث ${RESTART} برنامه می‌شود.`],
  },
  scale_app: {
    rationale: "برنامه خاموش است.",
    rationaleRequested: "به درخواست شما روشن یا خاموش کردن برنامه پیشنهاد شد.",
    effectStart: "برنامه {app} روشن می‌شود.",
    effectStop: "برنامه {app} خاموش می‌شود و تا روشن کردن دوباره در دسترس نیست.",
    risks: ["تا پایان راه‌اندازی، سایت در دسترس نیست."],
  },
  scale_db: {
    rationale: "پایگاه داده {db} خاموش است و برنامه نمی‌تواند به آن وصل شود.",
    effect: "پایگاه داده {db} روشن می‌شود.",
    risks: ["تا پایان راه‌اندازی پایگاه داده، اتصال برنامه‌ها به آن برقرار نمی‌شود."],
  },
  resize: {
    rationaleMemory: "برنامه به دلیل کمبود حافظه چند بار متوقف شده و مصرف حافظه نزدیک سقف پلن است.",
    rationaleCpu: "مصرف پردازنده برنامه به‌طور پایدار نزدیک سقف پلن است.",
    effect: "پلن برنامه {app} از {from} به {to} ارتقا می‌یابد.",
    risks: ["هزینه ساعتی برنامه افزایش می‌یابد.", `ارتقای پلن باعث ${RESTART} برنامه می‌شود.`, "اگر مصرف به دلیل نشت حافظه یا کد ناکارآمد باشد، ارتقا فقط مشکل را به تأخیر می‌اندازد."],
  },
  verification: {
    running: "برنامه در حال اجرا باشد و نسخه فعلی در وضعیت «آماده» باشد.",
    probes: `سه بار بررسی سلامت آدرس با فاصله حداقل ۵ ثانیه پاسخ ${statusCode("2xx")} بدهد.`,
    signatureGone: "نشانه خطای مشاهده‌شده پس از اجرا در لاگ‌ها تکرار نشود.",
    dbRunning: "پایگاه داده در حال اجرا باشد.",
    stopped: "برنامه خاموش باشد (scale=0).",
  },
} as const;

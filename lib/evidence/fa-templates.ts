// Persian templates for rule-based findings. Terminology comes from the shared glossary so the UI, the
// agent prompt and these fallbacks use the same words. Placeholders are `{name}`; numbers are rendered
// with Persian digits, identifiers (keys, hosts, tags) stay Latin.
import { glossary } from "@/lib/i18n/glossary.fa";
import { faNumber } from "@/lib/i18n/format";
import type { SourceName } from "./types";

const ENV = glossary["environment variable"];
const RELEASE = glossary.release;
const LOGS = glossary.logs;
const RESTART = glossary.restart;
const DEPLOY = glossary.deploy;

export type FaParams = Record<string, string | number | undefined>;

/** Fills `{name}` placeholders; missing values become «؟». Numbers get Persian digits. */
export function fill(template: string, params: FaParams = {}): string {
  return template
    .replace(/\{(\w+)\}/g, (_m, k: string) => {
      const v = params[k];
      if (v === undefined || v === "") return "؟";
      return typeof v === "number" ? faNumber(Math.round(v * 10) / 10) : v;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export const CAUSE_FA = {
  missing_env: {
    title: `${ENV} {key} تعریف نشده است`,
    body: `برنامه در ${LOGS} اعلام کرده که ${ENV} {key} وجود ندارد ({count} بار).`,
    absent: `این کلید در ${ENV}‌های برنامه تعریف نشده است.`,
    present: `این کلید در ${ENV}‌های برنامه وجود دارد؛ ممکن است مقدارش خالی باشد یا برنامه پس از تنظیم آن ${RESTART} نشده باشد.`,
  },
  wrong_port: {
    title: "برنامه روی پورت مورد انتظار در دسترس نیست",
    listen_differs: "برنامه روی پورت {listenPort} اجرا شده اما پورت تنظیم‌شده در لیارا {configuredPort} است.",
    loopback_bind: "برنامه فقط روی {bindHost} گوش می‌دهد و از بیرون کانتینر در دسترس نیست؛ باید روی 0.0.0.0 گوش دهد.",
    eaddrinuse: "پورت {port} از قبل در حال استفاده است (EADDRINUSE)؛ احتمالاً برنامه دو بار سرور را اجرا می‌کند.",
    probe_refused: "درخواست بررسی سلامت پاسخ نگرفت ({probe}) در حالی که برنامه در حال اجراست؛ معمولاً یعنی پورت اشتباه است.",
    probe_unreachable: "لیارا نتوانست به برنامه برسد ({probe})؛ این با گوش دادن برنامه روی پورتی غیر از پورت تنظیم‌شده سازگار است.",
  },
  crash_after_release: {
    title: `خطای برنامه پس از ${DEPLOY} {tag}`,
    titleNoRelease: "برنامه با خطا متوقف می‌شود",
    body: "برنامه با خطای {errorType} متوقف می‌شود ({count} بار){frame}.",
    frame: " در {frame}",
    crashloop: "برنامه پشت سر هم {restarts} بار راه‌اندازی شده است (حلقه کرش).",
    after: `شروع خطاها {delta} ثانیه پس از ${DEPLOY} ${RELEASE} {tag} بوده است.`,
    previous: `${RELEASE} قبلی سالم ({previousTag}) موجود است.`,
  },
  build_failure: {
    title: `ساخت ${RELEASE} {tag} با خطا متوقف شد`,
    titleServing: `ساخت ${RELEASE} {tag} ناموفق بود؛ برنامه همچنان ${RELEASE} {currentTag} را اجرا می‌کند`,
    body: `ساخت ${RELEASE} به دلیل خطای وابستگی یا ساخت ناموفق بود: {detail}.`,
    running: `${RELEASE} قبلی همچنان در حال اجراست؛ تا رفع خطا ${DEPLOY} جدید انجام نمی‌شود.`,
    serving: `جدیدترین ${RELEASE} ({tag}) با وضعیت {state} به پایان رسید و لیارا همچنان ${RELEASE} {currentTag} را اجرا می‌کند؛ مشکلات ${RELEASE} {currentTag} (اگر باشد) جداگانه آمده‌اند.`,
    /** What to change, per build rule. Stated as a suggestion that follows from this hypothesis. */
    fix: {
      npm_no_matching_version: "پیشنهاد (بر پایهٔ این فرضیه): نسخه‌ای از بستهٔ {package} که با بازهٔ {range} جور باشد در مخزن npm وجود ندارد؛ بازهٔ نسخهٔ {package} را در package.json به نسخه‌ای موجود تغییر دهید (فهرست نسخه‌ها: npm view {package} versions) و دوباره مستقر کنید.",
      npm_not_found: "پیشنهاد (بر پایهٔ این فرضیه): بستهٔ {package} در مخزن npm پیدا نشد؛ نام بسته را در package.json بررسی کنید (احتمالاً غلط تایپی است).",
      npm_eresolve: "پیشنهاد (بر پایهٔ این فرضیه): نسخه‌های وابستگی‌ها با هم سازگار نیستند (ERESOLVE)؛ نسخه‌های peer dependency را در package.json هماهنگ کنید.",
      npm_error: "پیشنهاد (بر پایهٔ این فرضیه): npm با کد {code} متوقف شد؛ همان خط خطا در لاگ ساخت را برطرف کنید.",
      missing_module: "پیشنهاد (بر پایهٔ این فرضیه): ماژول {package} پیدا نشد؛ آن را به وابستگی‌های پروژه (package.json یا requirements.txt) اضافه کنید.",
      pip_no_version: "پیشنهاد (بر پایهٔ این فرضیه): نسخهٔ خواسته‌شده از بستهٔ {package} ({range}) پیدا نشد؛ نسخه را در requirements.txt اصلاح کنید.",
      pip_no_distribution: "پیشنهاد (بر پایهٔ این فرضیه): نسخهٔ خواسته‌شده از بستهٔ {package} ({range}) پیدا نشد؛ نسخه را در requirements.txt اصلاح کنید.",
      composer_requires: "پیشنهاد (بر پایهٔ این فرضیه): بستهٔ {package} با محدودهٔ {range} قابل نصب نیست؛ محدودهٔ نسخه را در composer.json اصلاح کنید.",
      composer_unresolvable: "پیشنهاد (بر پایهٔ این فرضیه): وابستگی‌های composer.json با هم قابل نصب نیستند؛ محدودهٔ نسخه‌ها را اصلاح کنید.",
      compile_error: "پیشنهاد (بر پایهٔ این فرضیه): کد هنگام ساخت کامپایل نشد؛ خطای کامپایل در لاگ ساخت را برطرف کنید.",
    } as Record<string, string>,
  },
  /** Which release a hypothesis is about (every rule-based hypothesis names it). */
  release_scope: {
    title: `(${RELEASE} {tag})`,
    titleNewer: `(${RELEASE} جدید {tag} که در حال سرویس نیست)`,
    current: `این فرضیه دربارهٔ ${RELEASE} فعلی برنامه ({tag}) است.`,
    newer: `این فرضیه دربارهٔ جدیدترین ${RELEASE} ({tag}) است که در حال سرویس نیست؛ برنامه همچنان ${RELEASE} {currentTag} را اجرا می‌کند.`,
    titleUnhealthy: `${RELEASE} جدید {tag} سالم بالا نیامد؛ برنامه همچنان ${RELEASE} {currentTag} را اجرا می‌کند`,
  },
  db_unreachable: {
    title: "اتصال به پایگاه داده {host} برقرار نمی‌شود",
    body: "برنامه نمی‌تواند به {host}{port} وصل شود ({code}، {count} بار).",
    stopped: "پایگاه داده {hostname} خاموش است (scale=0).",
    not_running: "وضعیت پایگاه داده {hostname} «{status}» است، نه RUNNING.",
    network_differs: "برنامه در شبکه {appNetwork} و پایگاه داده در شبکه {dbNetwork} است؛ اتصال خصوصی بین شبکه‌ها برقرار نمی‌شود.",
    public_off: "برنامه از آدرس عمومی پایگاه داده استفاده می‌کند اما دسترسی عمومی آن خاموش است.",
    local: "برنامه به localhost وصل می‌شود؛ در لیارا پایگاه داده روی میزبان جداگانه‌ای اجرا می‌شود.",
  },
  oom: {
    title: "کمبود حافظه (OOM)",
    body: "کانتینر برنامه {kills} بار به دلیل کمبود حافظه متوقف شده است.",
    heap: "حافظه heap برنامه پر شده است.",
    mem: "مصرف حافظه {memPct}٪ سقف پلن است.",
  },
  cpu_saturation: {
    title: "اشباع پردازنده (CPU)",
    body: "مصرف CPU به {peakCores} هسته رسید، یعنی {peakPct}٪ سقف پلن ({planCpu} هسته){detail}؛ این مشکل از کمبود حافظه نیست.",
    run: " و {run} نمونهٔ پیاپی در ۶۰٪ سقف یا بالاتر ماند",
    sustained: " و در بیشتر بازه بالای ۸۰٪ ماند",
    singleCore: "برنامهٔ تک‌رشته‌ای (مثل Node.js) روی پلنی با کمتر از یک هسته در میانگین ۳۰ ثانیه‌ای معمولاً به ۱۰۰٪ نمی‌رسد؛ ماندن حدود ۶۰ تا ۷۵٪ سقف همراه با کندی پاسخ یعنی پردازنده اشباع شده است.",
    slow: "پاسخ سایت {latencyMs} میلی‌ثانیه طول کشید.",
    timeout: "بررسی سلامت سایت پس از {latencyMs} میلی‌ثانیه بی‌پاسخ ماند (timeout).",
    http5xx: "در لاگ درخواست‌ها پاسخ 5xx دیده شد.",
    slowRequests: "در لاگ درخواست‌ها درخواست‌های کند (بیش از ۳ ثانیه) دیده شد.",
    path: "درخواست‌های کند بیشتر مربوط به مسیر {path} است ({count} درخواست کند).",
    pathOnset: "کندی مسیر {path} همزمان با بالا رفتن مصرف CPU شروع شد.",
    afterRelease: `مصرف CPU پیش از ${RELEASE} {tag} عادی بود و {delta} ثانیه پس از آن بالا رفت.`,
    competing: "همزمان خطا یا کمبود حافظه هم دیده شد؛ ممکن است مصرف بالای CPU پیامد آن باشد، نه علت اصلی.",
    noHelp: `${RESTART} یا افزایش حافظه (RAM) این مشکل را حل نمی‌کند؛ گلوگاه پردازنده است و پس از ${RESTART} با اولین درخواست‌های سنگین دوباره پر می‌شود.`,
    suggestion: "پیشنهاد (بر پایهٔ این فرضیه): درخواستی را که پردازش سنگین و همگام انجام می‌دهد پیدا کنید (مثلاً با فعال کردن access log همراه با زمان پاسخ هر مسیر) و آن کار را بهینه یا به پس‌زمینه/worker منتقل کنید؛ یا پلنی با CPU بیشتر انتخاب کنید.",
    suggestionPath: "پیشنهاد (بر پایهٔ این فرضیه): handler مسیر {path} را بررسی کنید و پردازش سنگین و همگام آن را بهینه یا به پس‌زمینه/worker منتقل کنید؛ یا پلنی با CPU بیشتر انتخاب کنید.",
  },
  external_dependency: {
    title: "سرویس خارجی {host} در دسترس نیست",
    body: "برنامه نمی‌تواند به سرویس خارجی {host} وصل شود ({code}، {count} بار). مشکل احتمالاً بیرون از لیاراست.",
  },
  transient_unknown: {
    title: "مشکل گذرا یا نامشخص",
    body: `در ${LOGS} نشانه خطای مشخصی دیده نشد، اما برنامه سالم پاسخ نمی‌دهد ({symptom}).`,
    more: `شواهد برای تشخیص علت یا پیشنهاد اقدام کافی نیست؛ یک دقیقه دیگر دوباره بررسی کنید و اگر برنامه وب است ثبت لاگ درخواست‌ها (access log) را فعال کنید.`,
  },
} as const;

export const RULED_OUT_FA = {
  memory: { title: "کمبود حافظه رد شد", reason: "مصرف حافظه {memPct}٪ سقف پلن است و نشانه‌ای از OOM دیده نشد." },
  cpu: { title: "اشباع پردازنده رد شد", reason: "مصرف CPU {cpuPct}٪ ظرفیت پلن است." },
  availability: { title: "در دسترس نبودن سایت رد شد", reason: "سایت با کد {status} در {latencyMs} میلی‌ثانیه پاسخ داد." },
  build: { title: "خطای ساخت رد شد", reason: `${RELEASE} فعلی ({tag}) با موفقیت ساخته و اجرا شده است.` },
  db_stopped: { title: "خاموش بودن پایگاه داده رد شد", reason: "پایگاه داده {hostname} در حال اجراست." },
  missing_env: { title: `نبودن ${ENV} {key} رد شد`, reason: `این کلید در ${ENV}‌های برنامه تعریف شده است.` },
} as const;

export const UNKNOWN_FA: Record<SourceName | "http_status" | "logs_empty" | "plan_limits", { description: string; howToGet: string }> = {
  app: { description: "جزئیات برنامه از لیارا دریافت نشد.", howToGet: "دوباره تلاش کنید یا صفحه برنامه را در کنسول لیارا ببینید." },
  applets: { description: "وضعیت کانتینرهای برنامه (applets) دریافت نشد.", howToGet: "بخش وضعیت برنامه در کنسول لیارا را بررسی کنید." },
  releases: { description: `فهرست ${RELEASE}‌ها دریافت نشد؛ ارتباط خطا با ${DEPLOY} اخیر بررسی نشد.`, howToGet: `تب ${RELEASE}‌ها را باز کنید.` },
  release_detail: { description: `جزئیات آخرین ${RELEASE} دریافت نشد.`, howToGet: `جزئیات ${RELEASE} را در تب ${RELEASE}‌ها ببینید.` },
  build_logs: { description: `${LOGS} ساخت آخرین ${RELEASE} دریافت نشد.`, howToGet: `${LOGS} ساخت را در جزئیات ${RELEASE} ببینید.` },
  events: { description: `رویدادهای برنامه (${RESTART}، OOM، تغییر ${ENV}) دریافت نشد.`, howToGet: "بخش رویدادها را در کنسول لیارا ببینید." },
  runtime_logs: { description: `${LOGS} اجرای برنامه در دسترس نبود؛ علت خطا از روی ${LOGS} بررسی نشد.`, howToGet: `تب ${LOGS} را باز کنید یا liara logs --app <نام برنامه> را اجرا کنید.` },
  metrics_summary: { description: "مصرف فعلی CPU و حافظه دریافت نشد.", howToGet: "تب نمودارها را باز کنید." },
  metrics_series: { description: "روند مصرف CPU و حافظه در بازه اخیر دریافت نشد.", howToGet: "تب نمودارها را باز کنید." },
  probe: { description: "بررسی سلامت آدرس برنامه انجام نشد.", howToGet: "آدرس برنامه را در مرورگر باز کنید." },
  plan: { description: "مشخصات پلن برنامه دریافت نشد؛ درصد مصرف منابع محاسبه نشد.", howToGet: "پلن برنامه را در تنظیمات آن ببینید." },
  databases: { description: "فهرست پایگاه‌های داده دریافت نشد؛ ارتباط خطا با پایگاه داده بررسی نشد.", howToGet: "بخش پایگاه‌های داده را باز کنید." },
  db_detail: { description: "جزئیات پایگاه داده دریافت نشد.", howToGet: "صفحه پایگاه داده را در کنسول لیارا ببینید." },
  db_list: { description: "پایگاه داده در فهرست پایگاه‌های داده پیدا نشد یا فهرست دریافت نشد.", howToGet: "نام یا شناسه پایگاه داده را بررسی کنید." },
  db_metrics: { description: "مصرف منابع پایگاه داده دریافت نشد.", howToGet: "تب نمودارهای پایگاه داده را باز کنید." },
  db_events: { description: "رویدادهای پایگاه داده دریافت نشد.", howToGet: "بخش رویدادهای پایگاه داده را ببینید." },
  http_status: { description: `آمار کدهای وضعیت HTTP در دسترس نیست؛ در ${LOGS} خط درخواست (access log) پیدا نشد.`, howToGet: "ثبت لاگ درخواست‌ها را در برنامه فعال کنید." },
  logs_empty: { description: `در {windowMin} دقیقه اخیر هیچ ${LOGS} اجرایی ثبت نشده است.`, howToGet: `بازه طولانی‌تری از ${LOGS} را بررسی کنید.` },
  plan_limits: { description: "سقف CPU و حافظه پلن مشخص نیست؛ نزدیکی به سقف منابع سنجیده نشد.", howToGet: "پلن برنامه را در تنظیمات آن ببینید." },
};

export const LIMITS_FA = {
  window: `فقط ${LOGS} و رویدادهای {windowMin} دقیقه اخیر بررسی شد.`,
  metricsUnits: "واحد داده‌های مصرف منابع لیارا هنوز تأیید نشده است؛ درصدها تقریبی‌اند.",
  noRollback: `لیارا بازگشت مستقیم (rollback) ندارد؛ بازگشت یعنی ${DEPLOY} دوباره ${RELEASE} قبلی.`,
  onsetBeforeWindow: "خطاها از ابتدای بازه بررسی وجود داشتند؛ شروع واقعی ممکن است زودتر باشد.",
  linesCapped: `تعداد خطوط ${LOGS} زیاد بود و فقط {lines} خط آخر بررسی شد.`,
  partial: "بخشی از داده‌ها دریافت نشد؛ نتیجه بر اساس شواهد ناقص است.",
  previousReleaseLines: `{count} خط از ${LOGS} مربوط به ${RELEASE}‌های قبلی ({tags}) بود؛ این خطوط فقط به‌عنوان سابقه نمایش داده شده‌اند و در تشخیص وضعیت فعلی (${RELEASE} {current}) به کار نرفته‌اند.`,
  buildLogsPartial: `${LOGS} ساخت کامل خوانده نشد (سقف صفحه یا خط، یا خطا در صفحه‌های بعدی)؛ ممکن است علت اصلی در بخش خوانده‌نشده باشد.`,
} as const;

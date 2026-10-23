"use client";

import { Inbox, Plus, Search, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Code, Ltr } from "@/components/code";
import { BalanceChip } from "@/components/shell/top-bar";
import { ServicePanelSlot } from "@/components/shell/service-panel-slot";
import { AppShell } from "@/components/shell/app-shell";
import { useShellStore } from "@/components/shell/shell-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { KeyValueList } from "@/components/ui/key-value-list";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Stat, StatGroup } from "@/components/ui/stat";
import { SERVICE_STATUSES } from "@/components/ui/status";
import { StatusDot } from "@/components/ui/status-dot";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { TypeToConfirm } from "@/components/ui/type-to-confirm";
import { fa } from "@/lib/i18n/fa";
import { faDate, faDateTime, faNumber, faPrice, isoUtc, relativeTime } from "@/lib/i18n/format";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border py-6">
      <h2 className="text-lg font-semibold">
        <bdi dir="ltr">{title}</bdi>
      </h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

export function Kit() {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [on, setOn] = useState(true);
  const [version, setVersion] = useState("20");
  const now = new Date();
  const items = [
    { key: "آدرس", value: "https://shop.liara.run", ltr: true, copy: "https://shop.liara.run" },
    { key: "پورت", value: "3000", ltr: true },
    { key: "پلن", value: "استاندارد، ۱ گیگابایت رم" },
  ];

  return (
    <AppShell
      user={{ userName: "سارا احمدی" }}
      balance={<BalanceChip toman={1250000} />}
      healthWatch={<StatusDot status="healthy" />}
      projectSwitcher={<Badge tone="accent">شبکه‌ی فروشگاه</Badge>}
      servicePanel={
        <ServicePanelSlot title="shop-app">
          {({ service, tab, setTab }) => (
            <Tabs value={tab ?? "overview"} onValueChange={setTab} className="p-4">
              <TabsList>
                <TabsTrigger value="overview">{fa.service.tabs.overview}</TabsTrigger>
                <TabsTrigger value="logs">{fa.service.tabs.logs}</TabsTrigger>
              </TabsList>
              <TabsContent value="overview">
                <Ltr>{service}</Ltr>
              </TabsContent>
              <TabsContent value="logs">
                <Code>{"GET /checkout 500 (12ms)"}</Code>
              </TabsContent>
            </Tabs>
          )}
        </ServicePanelSlot>
      }
    >
      <div className="mx-auto max-w-4xl px-4 pb-24">
        <h1 className="pt-6 text-2xl font-bold">{fa.kit.title}</h1>
        <p className="text-muted">{fa.kit.note}</p>

        <Section title="Button">
          <Button>{fa.common.save}</Button>
          <Button variant="secondary">{fa.common.cancel}</Button>
          <Button variant="ghost">{fa.common.more}</Button>
          <Button variant="danger">
            <Trash2 aria-hidden className="size-4" />
            {fa.common.delete}
          </Button>
          <Button size="sm">sm</Button>
          <Button size="lg">lg</Button>
          <Button loading loadingText={fa.common.saving}>
            {fa.common.save}
          </Button>
          <Button disabled>{fa.common.save}</Button>
          <Button fullWidth variant="secondary">
            full width
          </Button>
        </Section>

        <Section title="IconButton / Tooltip / Kbd / Spinner">
          <IconButton label={fa.common.search} icon={<Search aria-hidden className="size-5" />} />
          <IconButton variant="secondary" label={fa.common.add} icon={<Plus aria-hidden className="size-5" />} />
          <IconButton variant="danger" label={fa.common.delete} icon={<Trash2 aria-hidden className="size-5" />} />
          <IconButton loading label={fa.common.loading} icon={null} />
          <Tooltip content={fa.common.copy}>
            <Button variant="secondary">hover / focus</Button>
          </Tooltip>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
          <Spinner label={fa.common.loading} />
        </Section>

        <Section title="Input / Textarea / Select / Switch">
          <div className="grid w-full gap-4 sm:grid-cols-2">
            <Field label="نام اپ" hint="فقط حروف کوچک انگلیسی" >
              {(p) => <Input {...p} dir="ltr" placeholder="my-app" className="text-start" />}
            </Field>
            <Field label="نام اپ" error="این نام قبلاً استفاده شده است">
              {(p) => <Input {...p} defaultValue="shop" dir="ltr" className="text-start" />}
            </Field>
            <Field label="توضیحات" optional>
              {(p) => <Textarea {...p} placeholder="مشکل را بنویسید…" />}
            </Field>
            <Field label="نسخه‌ی Node.js">
              {(p) => (
                <Select
                  {...p}
                  value={version}
                  onValueChange={setVersion}
                  options={[
                    { value: "18", label: "Node 18" },
                    { value: "20", label: "Node 20" },
                    { value: "22", label: "Node 22", disabled: true },
                  ]}
                />
              )}
            </Field>
            <Switch checked={on} onCheckedChange={setOn} label="شبکه‌ی عمومی" description="دسترسی از بیرون شبکه‌ی خصوصی" />
            <Switch disabled label="غیرفعال" />
          </div>
        </Section>

        <Section title="StatusDot / Badge">
          <div className="flex w-full flex-wrap gap-x-6 gap-y-2">
            {SERVICE_STATUSES.map((s) => (
              <StatusDot key={s} status={s} />
            ))}
          </div>
          <div className="flex w-full flex-wrap gap-2">
            {SERVICE_STATUSES.map((s) => (
              <StatusDot key={s} status={s} compact />
            ))}
          </div>
          <Badge>neutral</Badge>
          <Badge tone="accent">accent</Badge>
          <Badge tone="ok">ok</Badge>
          <Badge tone="warn">warn</Badge>
          <Badge tone="danger">danger</Badge>
        </Section>

        <Section title="Card / Stat / KeyValueList">
          <Card className="w-full sm:w-80">
            <CardHeader>
              <CardTitle>shop-app</CardTitle>
              <CardDescription>آخرین انتشار {relativeTime(new Date(now.getTime() - 12 * 60_000), now)}</CardDescription>
            </CardHeader>
            <CardContent>
              <StatGroup className="sm:grid-cols-2 lg:grid-cols-2">
                <Stat label="پردازنده" value={`${faNumber(37)}٪`} />
                <Stat label="هزینه" value={faPrice(120000)} hint="در ماه" />
              </StatGroup>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="secondary">
                {fa.common.details}
              </Button>
            </CardFooter>
          </Card>
          <Card className="w-full flex-1 sm:min-w-80">
            <CardContent>
              <KeyValueList items={items} />
            </CardContent>
          </Card>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="a" className="w-full">
            <TabsList>
              <TabsTrigger value="a">{fa.service.tabs.overview}</TabsTrigger>
              <TabsTrigger value="b">{fa.service.tabs.releases}</TabsTrigger>
              <TabsTrigger value="c">{fa.service.tabs.logs}</TabsTrigger>
              <TabsTrigger value="d">{fa.service.tabs.resources}</TabsTrigger>
              <TabsTrigger value="e">{fa.service.tabs.variables}</TabsTrigger>
              <TabsTrigger value="f">{fa.service.tabs.domains}</TabsTrigger>
              <TabsTrigger value="g">{fa.service.tabs.settings}</TabsTrigger>
            </TabsList>
            <TabsContent value="a">محتوای نمای کلی</TabsContent>
            <TabsContent value="b">محتوای نسخه‌ها</TabsContent>
          </Tabs>
        </Section>

        <Section title="Dialog / Sheet / TypeToConfirm / Toast / Service panel">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Dialog</Button>
            </DialogTrigger>
            <DialogContent
              title="راه‌اندازی مجدد اپ"
              description="اپ چند ثانیه در دسترس نخواهد بود."
              footer={
                <>
                  <Button variant="secondary">{fa.common.cancel}</Button>
                  <Button>{fa.common.confirm}</Button>
                </>
              }
            >
              <p className="text-sm leading-7">آیا مطمئن هستید؟ می‌توانید با کلید Esc هم ببندید.</p>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">Sheet (start / bottom on mobile)</Button>
            </SheetTrigger>
            <SheetContent title="جزئیات" description="در موبایل از پایین باز می‌شود." side="start">
              <div className="p-5">
                <SkeletonText lines={4} />
              </div>
            </SheetContent>
          </Sheet>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            TypeToConfirm
          </Button>
          <Button variant="danger" onClick={() => setDangerOpen(true)}>
            TypeToConfirm (danger)
          </Button>
          <TypeToConfirm
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            name="shop-db"
            title="ساخت دیتابیس جدید"
            description="این کار هزینه دارد."
            onConfirm={async () => {
              await new Promise((r) => setTimeout(r, 600));
              toast({ title: "دیتابیس ساخته شد", variant: "success" });
            }}
          />
          <TypeToConfirm
            open={dangerOpen}
            onOpenChange={setDangerOpen}
            name="shop-app"
            danger
            title="حذف اپ"
            description="همه‌ی نسخه‌ها و تنظیمات حذف می‌شود."
            confirmLabel={fa.common.delete}
            onConfirm={() => {
              throw new Error("demo failure");
            }}
          />
          <Button variant="secondary" onClick={() => toast({ title: "ذخیره شد", description: "تنظیمات اعمال شد.", variant: "success" })}>
            Toast success
          </Button>
          <Button variant="secondary" onClick={() => toast({ title: "اتصال برقرار نشد", variant: "error" })}>
            Toast error
          </Button>
          <Button variant="secondary" onClick={() => toast({ title: "هشدار", variant: "warning" })}>
            Toast warning
          </Button>
          <Button variant="secondary" onClick={() => useShellStore.getState().openService("shop-app", "overview")}>
            Open service panel
          </Button>
          <CopyButton value="https://shop.liara.run" />
          <CopyButton value="DATABASE_URL" label={fa.common.copy} />
        </Section>

        <Section title="EmptyState / ErrorBanner / Skeleton">
          <Card className="w-full">
            <EmptyState
              icon={<Inbox />}
              title={fa.canvas.emptyTitle}
              description={fa.canvas.emptyBody}
              action={<Button>{fa.create.newApp}</Button>}
            />
          </Card>
          <ErrorBanner
            className="w-full"
            title={fa.errors.loadFailed}
            message={fa.errors.liaraTimeout}
            detail="GET /v1/apps 504"
            onRetry={() => toast({ title: fa.common.retry })}
          />
          <ErrorBanner className="w-full" tone="warn" message={fa.errors.incompleteEvidence} />
          <div className="flex w-full flex-col gap-2" aria-busy>
            <Skeleton className="h-8 w-48" />
            <SkeletonText lines={3} />
          </div>
        </Section>

        <Section title="RTL / bidi / formatting">
          <div className="w-full space-y-3 leading-8">
            <p>
              پس از آخرین {fa.service.restart}، آدرس <Ltr>https://shop.liara.run/checkout</Ltr> خطای <Ltr>500</Ltr> برمی‌گرداند و
              متغیر <Ltr>DATABASE_URL</Ltr> در مسیر <Ltr>/app/server.js:42</Ltr> تنظیم نشده است.
            </p>
            <p>
              تاریخ: {faDate(now)} · زمان: {faDateTime(now)} · {relativeTime(new Date(now.getTime() - 3 * 3600_000), now)}
            </p>
            <p dir="ltr" className="font-mono text-sm">
              {isoUtc(now)}
            </p>
            <p>
              قیمت: {faPrice(1234567)} · عدد: {faNumber(1234567.89)}
            </p>
            <Code>{`Error: connect ECONNREFUSED 10.0.3.7:5432\n    at TCPConnectWrap.afterConnect (node:net:1555:16)`}</Code>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

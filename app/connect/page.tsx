import type { Metadata } from "next";
import { LogoMark } from "@/components/shell/logo";
import { fa } from "@/lib/i18n/fa";
import { ConnectForm } from "./connect-form";
import { ConnectBullets, TopologyIllustration } from "./connect-visual";

export const metadata: Metadata = { title: `${fa.connect.title} | ${fa.common.appName}` };

export default function ConnectPage() {
  const bullets = [fa.connect.bullets.one, fa.connect.bullets.two, fa.connect.bullets.three];
  return (
    <main id="main-content" tabIndex={-1} className="relative isolate min-h-dvh overflow-x-clip outline-none">
      {/* Instrument grid that fades out toward the edges. */}
      <div
        aria-hidden
        className="bg-dot-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_70%_60%_at_60%_40%,black,transparent)]"
      />

      <div className="mx-auto grid min-h-dvh w-full max-w-6xl content-center gap-x-16 gap-y-8 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:content-start lg:gap-y-6 lg:pb-12 lg:pt-[max(3rem,11vh)]">
        <header className="flex flex-col gap-4">
          <h1 className="max-w-[18ch] text-2xl font-extrabold leading-[1.35] tracking-normal sm:text-[32px]">{fa.connect.headline}</h1>
          <p className="max-w-[52ch] text-base leading-7 text-muted">{fa.connect.lead}</p>
        </header>

        <section
          aria-labelledby="connect-form-title"
          className="rounded-lg border border-border bg-glass p-5 shadow-[var(--shadow-pop)] backdrop-blur-xl sm:p-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
        >
          <div className="mb-6 flex items-center gap-3">
            <LogoMark className="size-9" />
            <div className="flex min-w-0 flex-col">
              <h2 id="connect-form-title" className="text-lg font-bold">
                {fa.connect.title}
              </h2>
              <span className="text-sm text-muted">{fa.common.appName}</span>
            </div>
          </div>
          <ConnectForm />
        </section>

        <div className="flex flex-col gap-6 lg:self-start">
          <div className="relative -mx-2">
            <TopologyIllustration className="h-auto w-full max-w-[440px]" />
          </div>
          <ConnectBullets items={bullets} />
        </div>
      </div>
    </main>
  );
}

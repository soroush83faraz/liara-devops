import type { Metadata } from "next";
import { Check } from "lucide-react";
import { LogoMark } from "@/components/shell/logo";
import { fa } from "@/lib/i18n/fa";
import { ConnectForm } from "./connect-form";

export const metadata: Metadata = { title: `${fa.connect.title} | ${fa.common.appName}` };

export default function ConnectPage() {
  const bullets = [fa.connect.bullets.one, fa.connect.bullets.two, fa.connect.bullets.three];
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto grid min-h-dvh w-full max-w-5xl items-center gap-10 px-4 py-10 outline-none lg:grid-cols-2 lg:gap-16">
      <section className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <LogoMark className="size-10" />
          <span className="text-lg font-bold text-accent">{fa.common.appName}</span>
        </div>
        <h1 className="text-balance text-3xl font-bold leading-[1.6] sm:text-4xl sm:leading-[1.5]">{fa.connect.headline}</h1>
        <p className="text-muted">{fa.connect.lead}</p>
        <ul className="flex flex-col gap-3">
          {bullets.map((text) => (
            <li key={text} className="flex items-start gap-3 text-[15px] leading-8">
              <span aria-hidden className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                <Check className="size-3.5" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="connect-form-title" className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-7">
        <h2 id="connect-form-title" className="mb-5 text-xl font-semibold">
          {fa.connect.title}
        </h2>
        <ConnectForm />
      </section>
    </main>
  );
}

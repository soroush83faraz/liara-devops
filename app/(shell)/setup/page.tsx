// /setup: the setup assistant. Same session pattern as the home page: redirect to /connect without a session.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SetupWizard } from "@/components/setup";
import { ProductShell } from "@/components/product/product-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { fa } from "@/lib/i18n/fa";
import { getSessionForPage, sessionPublicView } from "@/lib/session";

export const metadata: Metadata = { title: fa.setupFlow.page.title };

export default function SetupPage() {
  return (
    <Suspense fallback={<SetupFallback />}>
      <SetupContent />
    </Suspense>
  );
}

async function SetupContent() {
  const session = await getSessionForPage();
  const view = sessionPublicView(session.token ? session : null);
  if (!view) redirect("/connect");
  return (
    <ProductShell user={{ userName: view.userName, accountId: view.accountId, teamName: view.teamName }}>
      <SetupWizard />
    </ProductShell>
  );
}

function SetupFallback() {
  return (
    <div aria-busy className="flex h-dvh flex-col">
      <div className="h-14 border-b border-border bg-surface" />
      <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 p-6">
        <Skeleton className="h-8 w-48" />
      </main>
    </div>
  );
}

// Monitoring dashboard («پایش»). Session redirect first, inside Suspense (cacheComponents: the session read is request-time data).
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CanvasServicePanel } from "@/components/canvas";
import { ObservabilityDashboard } from "@/components/observability/observability-dashboard";
import { ProductShell } from "@/components/product/product-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionForPage, sessionPublicView } from "@/lib/session";

export default function ObservabilityPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ObservabilityContent />
    </Suspense>
  );
}

async function ObservabilityContent() {
  const session = await getSessionForPage();
  const view = sessionPublicView(session.token ? session : null);
  if (!view) redirect("/connect");
  return (
    <ProductShell user={{ userName: view.userName, accountId: view.accountId, teamName: view.teamName }} servicePanel={<CanvasServicePanel />}>
      <ObservabilityDashboard accountId={view.accountId} />
    </ProductShell>
  );
}

function PageFallback() {
  return (
    <div aria-busy className="flex h-dvh flex-col">
      <div className="h-14 border-b border-border bg-surface" />
      <main id="main-content" className="flex-1 p-6">
        <Skeleton className="h-8 w-48" />
      </main>
    </div>
  );
}

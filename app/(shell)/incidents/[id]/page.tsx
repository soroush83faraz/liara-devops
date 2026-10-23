// Incident report (shareable, printable). Session redirect and params are request-time data: read inside Suspense.
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { IncidentReport } from "@/components/copilot/incidents/incident-report";
import { ProductShell } from "@/components/product/product-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { SAFE_ID_RE } from "@/lib/contracts";
import { getSessionForPage, sessionPublicView } from "@/lib/session";

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageFallback />}>
      <IncidentContent params={params} />
    </Suspense>
  );
}

async function IncidentContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionForPage();
  const view = sessionPublicView(session.token ? session : null);
  if (!view) redirect("/connect");
  if (!SAFE_ID_RE.test(id)) notFound();
  return (
    <ProductShell user={{ userName: view.userName, accountId: view.accountId, teamName: view.teamName }}>
      <IncidentReport id={id} />
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

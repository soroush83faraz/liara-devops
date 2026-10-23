// Incident list. Session redirect first, inside Suspense (the session read is request-time data under Cache Components).
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { IncidentsList } from "@/components/copilot/incidents/incidents-list";
import { ProductShell } from "@/components/product/product-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionForPage, sessionPublicView } from "@/lib/session";

export default function IncidentsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <IncidentsContent />
    </Suspense>
  );
}

async function IncidentsContent() {
  const session = await getSessionForPage();
  const view = sessionPublicView(session.token ? session : null);
  if (!view) redirect("/connect");
  return (
    <ProductShell user={{ userName: view.userName, accountId: view.accountId, teamName: view.teamName }}>
      <IncidentsList />
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

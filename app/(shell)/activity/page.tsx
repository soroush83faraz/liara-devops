// Activity (audit log). Session redirect first, inside Suspense.
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActivityList } from "@/components/copilot/activity/activity-list";
import { ProductShell } from "@/components/product/product-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionForPage, sessionPublicView } from "@/lib/session";

export default function ActivityPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ActivityContent />
    </Suspense>
  );
}

async function ActivityContent() {
  const session = await getSessionForPage();
  const view = sessionPublicView(session.token ? session : null);
  if (!view) redirect("/connect");
  return (
    <ProductShell user={{ userName: view.userName, accountId: view.accountId, teamName: view.teamName }}>
      <ActivityList />
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

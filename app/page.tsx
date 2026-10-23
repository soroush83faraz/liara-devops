// Home: the project canvas. Session redirect first (inside Suspense, as the session read is request-time data).
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Canvas, CanvasServicePanel } from "@/components/canvas";
import { ProductShell } from "@/components/product/product-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionForPage, sessionPublicView } from "@/lib/session";

export default function Home() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const session = await getSessionForPage();
  const view = sessionPublicView(session.token ? session : null);
  if (!view) redirect("/connect");
  return (
    <ProductShell
      user={{ userName: view.userName, accountId: view.accountId, teamName: view.teamName }}
      servicePanel={<CanvasServicePanel />}
      mainClassName="overflow-hidden"
    >
      <Canvas accountId={view.accountId} />
    </ProductShell>
  );
}

function HomeFallback() {
  return (
    <div aria-busy className="flex h-dvh flex-col">
      <div className="h-14 border-b border-border bg-surface" />
      <main id="main-content" className="flex-1 p-6">
        <Skeleton className="h-8 w-48" />
      </main>
    </div>
  );
}

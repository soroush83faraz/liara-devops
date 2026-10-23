"use client";

import { useCreateStore } from "@/lib/create/store";
import { AppWizard } from "./app-wizard";
import { DbWizard } from "./db-wizard";
import { DeployDialog } from "./deploy-dialog";
import { NetworkWizard } from "./network-wizard";

/** Renders whichever create dialog the store asks for. Mount once (CreateMenuSlot does). */
export function CreateHost() {
  const dialog = useCreateStore((s) => s.dialog);
  const close = useCreateStore((s) => s.close);
  if (!dialog) return null;
  switch (dialog.kind) {
    case "network":
      return <NetworkWizard onClose={close} />;
    case "app":
      return <AppWizard key={`app:${dialog.network ?? ""}`} onClose={close} network={dialog.network} />;
    case "db":
      return <DbWizard key={`db:${dialog.network ?? ""}`} onClose={close} network={dialog.network} />;
    case "deploy":
      return <DeployDialog key={`deploy:${dialog.appName}`} appName={dialog.appName} platform={dialog.platform} onClose={close} />;
  }
}

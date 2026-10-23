// Read-only app tabs (U6a). Plain components with a stable props type; registration is wired by the conductor.
import { AppOverviewTab } from "./overview/app-overview-tab";
import { LogsTab } from "./logs/logs-tab";
import { MetricsTab } from "./metrics/metrics-tab";
import { ReleasesTab } from "./releases/releases-tab";
import type { AppPanelProps } from "@/lib/service/app-read/types";

export { AppOverviewTab, LogsTab, MetricsTab, ReleasesTab };
export { ReleaseActionsSlot } from "./releases/release-actions-slot";
export type { AppPanelProps };

type Tab = (props: AppPanelProps) => React.JSX.Element | null;

/** `register('app', tabId, Component)`; tab ids match `fa.service.tabs` (overview, releases, logs, resources). */
export function registerAppReadTabs(register: (kind: "app", tab: string, component: Tab) => void): void {
  register("app", "overview", AppOverviewTab);
  register("app", "releases", ReleasesTab);
  register("app", "logs", LogsTab);
  register("app", "resources", MetricsTab);
  register("app", "metrics", MetricsTab); // alias
}

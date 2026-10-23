// Side-effect module: registers the database tabs with the service-panel registry, with Persian labels.
// Add `import "@/components/service/db/register";` to components/canvas/panel-registrations.ts (conductor).
import { registerPanel } from "@/lib/canvas/panel-registry";
import { fa } from "@/lib/i18n/fa";
import { DbBackupsTab } from "./backups-tab";
import { DbEventsTab } from "./events-tab";
import { DbOverviewTab } from "./overview-tab";
import { DbResourcesTab } from "./resources-tab";
import { DbSettingsTab } from "./settings-tab";

const ORDER: Record<string, number> = { overview: 10, resources: 40, backups: 50, events: 60, settings: 70 };

const tabs = {
  overview: DbOverviewTab,
  resources: DbResourcesTab,
  backups: DbBackupsTab,
  events: DbEventsTab,
  settings: DbSettingsTab,
} as const;

for (const [tab, Component] of Object.entries(tabs)) {
  registerPanel("db", tab, Component, { label: (fa.service.tabs as Record<string, string>)[tab] ?? tab, order: ORDER[tab] });
}

// Side-effect module: registers the app tabs with the service-panel registry, with Persian labels.
import { registerPanel } from "@/lib/canvas/panel-registry";
import { fa } from "@/lib/i18n/fa";
import { registerAppReadTabs } from "./index";

const ORDER: Record<string, number> = { copilot: 0, overview: 10, releases: 20, logs: 30, resources: 40 };

registerAppReadTabs((kind, tab, Component) => {
  if (tab === "metrics") return; // alias of "resources"
  const label = (fa.service.tabs as Record<string, string>)[tab] ?? tab;
  registerPanel(kind, tab, Component as never, { label, order: ORDER[tab] ?? 100 });
});

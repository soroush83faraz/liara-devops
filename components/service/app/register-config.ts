// Side-effect module: registers the configuration tabs (variables, domains, disks, settings) with the
// service-panel registry, with Persian labels. Import it next to "./register" in
// components/canvas/panel-registrations.ts (owned by the conductor): `import "@/components/service/app/register-config";`
import { registerPanel } from "@/lib/canvas/panel-registry";
import { fa } from "@/lib/i18n/fa";
import { DisksTab } from "./disks/disks-tab";
import { DomainsTab } from "./domains/domains-tab";
import { SettingsTab } from "./settings/settings-tab";
import { VariablesTab } from "./variables/variables-tab";
import type { AppPanelProps } from "@/lib/service/app-read/types";

type Tab = (props: AppPanelProps) => React.JSX.Element | null;

const ORDER: Record<string, number> = { variables: 50, domains: 60, disks: 70, settings: 80 };
const TABS: Array<[string, Tab]> = [
  ["variables", VariablesTab],
  ["domains", DomainsTab],
  ["disks", DisksTab],
  ["settings", SettingsTab],
];

for (const [tab, Component] of TABS) {
  const label = (fa.service.tabs as Record<string, string>)[tab] ?? tab;
  registerPanel("app", tab, Component as never, { label, order: ORDER[tab] ?? 100 });
}

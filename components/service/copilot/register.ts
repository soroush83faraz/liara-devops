// Side-effect module: registers the copilot («همیار») tab for apps and databases, first in the tab strip.
// Import it from components/canvas/panel-registrations.ts (the conductor wires this line):
//   import "@/components/service/copilot/register";
import { CopilotPanel } from "@/components/copilot/copilot-panel";
import { registerPanel } from "@/lib/canvas/panel-registry";
import { fa } from "@/lib/i18n/fa";

const meta = { label: fa.service.tabs.copilot, order: 0 } as const;

registerPanel("app", "copilot", CopilotPanel, meta);
registerPanel("db", "copilot", CopilotPanel, meta);

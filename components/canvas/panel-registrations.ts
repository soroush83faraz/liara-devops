// Side-effect imports that register service-panel tabs (see lib/canvas/panel-registry.ts). Service units add
// one line each, e.g. `import "@/components/service/app/register";`, which calls registerPanel(kind, tab, Component).
import "@/components/service/app/register";
import "@/components/service/app/register-config";
import "@/components/service/db/register";
import "@/components/service/copilot/register";

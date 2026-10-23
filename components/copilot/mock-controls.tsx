"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { devMock } from "@/lib/i18n/dev-mock";
import { getMockScenario, isMockEnabled, setMockScenario } from "@/lib/copilot/http";


/** Development-only: marks the synthetic backend and lets you pick the scenario. Renders nothing in production. */
export function MockControls() {
  const [on, setOn] = useState(false);
  const [scenario, setScenario] = useState("auto");
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // Client-only flags (URL / session storage) are read after hydration to keep SSR markup identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(isMockEnabled());
    setScenario(getMockScenario());
  }, []);
  if (process.env.NODE_ENV === "production" || !on) return null;
  // Built after the production guard so none of the dev copy is reachable from a production bundle.
  const p = devMock;
  const options = (Object.keys(p.scenarios) as Array<keyof typeof p.scenarios>).map((value) => ({ value, label: p.scenarios[value] }));
  return (
    <div role="note" className="flex flex-col gap-2 rounded-sm border border-dashed border-warn/60 bg-warn-soft p-3 text-warn-ink">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn" className="gap-1.5">
          <FlaskConical aria-hidden className="size-3.5" />
          {p.mockBadge}
        </Badge>
        <span className="text-xs">{p.mockNote}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs">{p.scenarioLabel}</span>
        <Select
          aria-label={p.scenarioLabel}
          options={options}
          value={scenario}
          onValueChange={(v) => {
            setScenario(v);
            setMockScenario(v);
          }}
          className="max-w-64"
        />
      </div>
    </div>
  );
}

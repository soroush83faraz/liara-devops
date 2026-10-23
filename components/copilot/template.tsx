import { Fragment, type ReactNode } from "react";

/**
 * Fills `{name}` placeholders in a Persian sentence with LTR-isolated fragments (names, ports, plans, keys), so
 * identifiers keep their direction inside RTL prose. Values render as React text only.
 */
export function Template({ template, params }: { template: string; params: Record<string, string | number> }): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const v = params[m[1]];
        if (v === undefined) return <Fragment key={i}>{part}</Fragment>;
        return (
          <bdi key={i} dir="ltr" className="rounded bg-code-bg px-1.5 py-0.5 font-mono text-[0.875em]">
            {String(v)}
          </bdi>
        );
      })}
    </>
  );
}

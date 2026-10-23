/** Usage as a percentage of size. Unit-agnostic (both numbers share Liara's unknown unit [VAL]); undefined when not computable. */
export function diskPercent(usage: number | undefined, size: number | undefined): number | undefined {
  if (usage === undefined || size === undefined || !Number.isFinite(usage) || !Number.isFinite(size) || size <= 0 || usage < 0) return undefined;
  return (usage / size) * 100;
}

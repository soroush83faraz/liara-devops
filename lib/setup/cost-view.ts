// Pure helpers for showing prices honestly in the setup wizard. A bundle without a price from Liara is shown as
// «قیمت نامشخص» and any total that includes it is marked incomplete («حداقل»); it is never counted as free.
import { faPrice } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/t";
import type { PlanOption } from "./sizing";

export type BundleView = PlanOption["bundles"][number];

/** `priceKnown` wins; a legacy option without it is known only when it carries a finite non-negative price. */
export function bundlePriceKnown(b: BundleView): boolean {
  if (typeof b.priceKnown === "boolean") return b.priceKnown;
  return typeof b.monthlyPrice === "number" && Number.isFinite(b.monthlyPrice) && b.monthlyPrice >= 0;
}

export function bundleOptionLabel(b: BundleView): string {
  return bundlePriceKnown(b) ? t("setupFlow.choices.bundleOption", { id: b.id, price: faPrice(b.monthlyPrice as number) }) : t("setupFlow.choices.bundleOptionUnknown", { id: b.id });
}

/** True when the chosen bundle of the chosen plan has no known price, so the total understates the cost. */
export function hasUnpricedBundle(plans: readonly PlanOption[] | undefined, planId: string, bundleId: string): boolean {
  if (!bundleId) return false;
  const bundle = plans?.find((p) => p.id === planId)?.bundles.find((b) => b.id === bundleId);
  return !bundle || !bundlePriceKnown(bundle);
}

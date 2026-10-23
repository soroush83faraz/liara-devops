import type { ReleaseDto } from "@/lib/service/app-read/types";

/**
 * SLOT (intentionally empty): the actions unit renders «redeploy previous» (and similar release actions) here.
 * This unit is read-only and must not add mutations. Keep the props stable; extend, do not rename.
 */
export function ReleaseActionsSlot(props: { appName: string; release: ReleaseDto }): null {
  void props;
  return null;
}

"use client";

import { BalanceChip } from "@/components/shell/top-bar";
import { useOverview } from "@/lib/canvas/use-overview";

/** Balance chip for the TopBar `balance` slot, fed by the shared overview query (unknown balance renders a dash). */
export function CanvasBalanceChip() {
  const { data } = useOverview();
  return <BalanceChip toman={data?.balance ?? null} source={data?.balanceSource} unreadable={data?.balanceUnreadable} />;
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/components/ui";
import { configKeys } from "../client";

/** After a successful mutation: refresh everything cached for the app and say so. */
export function useAfterMutation(name: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useCallback(
    (title: string, description?: string) => {
      void qc.invalidateQueries({ queryKey: configKeys.all(name) });
      toast({ title, description, variant: "success" });
    },
    [qc, name, toast],
  );
}

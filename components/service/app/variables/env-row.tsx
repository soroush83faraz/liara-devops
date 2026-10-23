"use client";

import { Eye, Lock, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { Badge, IconButton } from "@/components/ui";
import { isPublicEnvKey } from "@/lib/service/app-config/env-parse";
import type { MaskedEnvDto } from "@/lib/service/app-config/dto";
import { t } from "@/lib/i18n/t";

export function EnvRow({
  env,
  onReveal,
  onEdit,
  onDelete,
}: {
  env: MaskedEnvDto;
  onReveal: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isPublic = isPublicEnvKey(env.key);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <bdi dir="ltr" className="break-all font-mono text-sm font-semibold">
          {env.key}
        </bdi>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span aria-label={t("appConfig.vars.maskedValue")}>
            <bdi dir="ltr" className="font-mono tracking-widest">
              {env.valueLength === 0 ? t("appConfig.vars.emptyValue") : "••••••••"}
            </bdi>
          </span>
          {env.valueLength ? <span>{t("appConfig.vars.length", { count: env.valueLength })}</span> : null}
          {env.encrypted ? (
            <Badge tone="accent">
              <Lock aria-hidden className="size-3" />
              {t("appConfig.vars.encrypted")}
            </Badge>
          ) : null}
          {isPublic ? (
            <Badge tone="warn">
              <TriangleAlert aria-hidden className="size-3" />
              {t("appConfig.vars.publicBadge")}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <IconButton label={t("appConfig.vars.reveal")} icon={<Eye aria-hidden className="size-4" />} size="sm" onClick={onReveal} />
        <IconButton label={t("common.edit")} icon={<Pencil aria-hidden className="size-4" />} size="sm" onClick={onEdit} />
        <IconButton label={t("common.delete")} icon={<Trash2 aria-hidden className="size-4" />} size="sm" variant="danger" onClick={onDelete} />
      </div>
    </li>
  );
}

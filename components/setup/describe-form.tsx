"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DB_ENGINES, PLATFORMS, type DbEngine, type Platform } from "@/lib/contracts";
import type { Answers } from "@/lib/setup/analyze";
import { ENV_NAME_RE } from "@/lib/setup/env-names";
import { engineName, platformName } from "@/lib/setup/text";
import { t } from "@/lib/i18n/t";
import { Field } from "./field";

/** The fixed question list for people without a project file. Nothing here is inferred from the free text. */
export function DescribeForm({ busy, onSubmit }: { busy: boolean; onSubmit: (answers: Answers, description: string) => void }) {
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const [database, setDatabase] = useState<DbEngine | "none">("none");
  const [port, setPort] = useState("");
  const [image, setImage] = useState("");
  const [envNames, setEnvNames] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (platform === "") return setError(t("setupFlow.describe.needPlatform"));
    const names = envNames.split(/[,،\s]+/).map((s) => s.trim()).filter(Boolean);
    if (names.some((n) => !ENV_NAME_RE.test(n))) return setError(t("setupFlow.env.invalidName"));
    const p = port.trim() === "" ? undefined : Number(port);
    if (p !== undefined && !(Number.isInteger(p) && p >= 1 && p <= 65535)) return setError(t("setupFlow.errors.invalid_port"));
    setError(null);
    onSubmit(
      {
        platform,
        database,
        ...(p !== undefined ? { port: p } : {}),
        ...(image.trim() ? { dockerImage: image.trim() } : {}),
        ...(names.length ? { envNames: names } : {}),
      },
      description.trim(),
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-sm leading-7 text-muted">{t("setupFlow.describe.intro")}</p>
      <Field label={t("setupFlow.describe.description")} help={t("setupFlow.describe.descriptionHint")}>
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Field label={t("setupFlow.describe.platform")} error={error && platform === "" ? error : undefined}>
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={platform}
            placeholder={t("setupFlow.describe.platformPlaceholder")}
            onValueChange={(v) => setPlatform(v as Platform)}
            options={PLATFORMS.map((p) => ({ value: p, label: platformName(p) }))}
          />
        )}
      </Field>
      <Field label={t("setupFlow.describe.database")}>
        {({ id }) => (
          <Select
            id={id}
            value={database}
            onValueChange={(v) => setDatabase(v as DbEngine | "none")}
            options={[{ value: "none", label: t("setupFlow.describe.databaseNone") }, ...DB_ENGINES.map((e) => ({ value: e, label: engineName(e) }))]}
          />
        )}
      </Field>
      <Field label={t("setupFlow.describe.port")}>
        {({ id }) => <Input id={id} dir="ltr" inputMode="numeric" className="text-start font-mono" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))} />}
      </Field>
      <Field label={t("setupFlow.describe.dockerImage")} help={t("setupFlow.describe.dockerImageHint")}>
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} dir="ltr" className="text-start font-mono" value={image} onChange={(e) => setImage(e.target.value)} />}
      </Field>
      <Field label={t("setupFlow.describe.envNames")}>
        {({ id }) => <Input id={id} dir="ltr" className="text-start font-mono" value={envNames} onChange={(e) => setEnvNames(e.target.value)} />}
      </Field>
      {error && platform !== "" ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={busy} className="self-start">
        {t("setupFlow.describe.submit")}
      </Button>
    </form>
  );
}

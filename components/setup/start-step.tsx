"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Answers } from "@/lib/setup/analyze";
import { t } from "@/lib/i18n/t";
import { DescribeForm } from "./describe-form";
import { UploadBox } from "./upload-box";

export function StartStep({
  busy,
  onFile,
  onAnswers,
}: {
  busy: boolean;
  onFile: (file: File) => void;
  onAnswers: (answers: Answers, description: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold leading-9">{t("setupFlow.start.title")}</h2>
      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">{t("setupFlow.start.tabUpload")}</TabsTrigger>
          <TabsTrigger value="describe">{t("setupFlow.start.tabDescribe")}</TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
          <UploadBox busy={busy} onFile={onFile} />
        </TabsContent>
        <TabsContent value="describe">
          <DescribeForm busy={busy} onSubmit={onAnswers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

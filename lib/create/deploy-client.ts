"use client";
// Browser side of POST /api/apps/[name]/deploy: XHR (for upload progress) with the typed name in a header.
import type { ErrLike } from "./errors";

export interface DeployUploadInput {
  appName: string;
  typedName: string;
  port: string;
  /** Archive: the file + platform. Image: the image reference. */
  kind: "archive" | "image";
  file?: Blob;
  fileName?: string;
  platform?: string;
  image?: string;
}

export class DeployRequestError extends Error implements ErrLike {
  constructor(
    readonly status: number,
    readonly code?: string,
    readonly retryAfterSec?: number,
  ) {
    super(`deploy ${status}`);
    this.name = "DeployRequestError";
  }
}

export function uploadDeploy(
  input: DeployUploadInput,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ releaseId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/apps/${encodeURIComponent(input.appName)}/deploy`);
    xhr.setRequestHeader("x-typed-name", input.typedName);
    xhr.responseType = "json";
    let body: FormData | string;
    if (input.kind === "archive" && input.file) {
      const form = new FormData();
      form.append("source", "archive");
      form.append("port", input.port);
      form.append("type", input.platform ?? "");
      form.append("file", input.file, input.fileName ?? "source.zip");
      body = form;
    } else {
      xhr.setRequestHeader("content-type", "application/json");
      body = JSON.stringify({ source: "image", image: input.image, port: input.port });
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onerror = () => reject(new DeployRequestError(0, "network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    xhr.onload = () => {
      const res = xhr.response as { releaseId?: unknown; error?: { code?: string; retryAfterSec?: number } } | null;
      if (xhr.status >= 200 && xhr.status < 300 && typeof res?.releaseId === "string") return resolve({ releaseId: res.releaseId });
      reject(new DeployRequestError(xhr.status, res?.error?.code, res?.error?.retryAfterSec));
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

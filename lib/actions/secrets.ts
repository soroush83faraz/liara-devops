// Server-side secret generation and the per-operation set of values that must be scrubbed everywhere.
import { randomBytes } from "node:crypto";
import type { SecretGenerator } from "@/lib/contracts/env";

/**
 * 32 bytes from the OS CSPRNG. Generated here, never by a model. NOTE: a hex secret is not caught by the
 * pattern redactor (hex runs look like hashes), so every generated value MUST be added to a SecretSet.
 */
export function generateSecret(generator: SecretGenerator): string {
  const bytes = randomBytes(32);
  return generator === "hex32" ? bytes.toString("hex") : bytes.toString("base64url");
}

/** Accumulates every secret value an operation touches (env values, DB passwords, URLs, user input). */
export class SecretSet {
  private readonly values = new Set<string>();

  add(value: string | null | undefined): void {
    if (typeof value === "string" && value.length > 0) this.values.add(value);
  }

  addAll(values: Iterable<string | null | undefined>): void {
    for (const v of values) this.add(v);
  }

  list(): string[] {
    return [...this.values];
  }
}

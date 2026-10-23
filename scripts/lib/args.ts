import { parseArgs } from "node:util";

/** Bad command line: exit code 1. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** A safety guard refused the operation: exit code 2. */
export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export interface FlagSpec {
  strings?: readonly string[];
  booleans?: readonly string[];
}
export interface ParsedFlags {
  strings: Record<string, string | undefined>;
  booleans: Record<string, boolean>;
}

/** Strict flag parser (unknown flags and positionals are usage errors). `--` is accepted and ignored. */
export function parseFlags(argv: readonly string[], spec: FlagSpec): ParsedFlags {
  const options: Record<string, { type: "string" | "boolean" }> = {};
  for (const k of spec.strings ?? []) options[k] = { type: "string" };
  for (const k of spec.booleans ?? []) options[k] = { type: "boolean" };
  try {
    const { values } = parseArgs({ args: argv.filter((a, i) => !(a === "--" && i === 0)), options, strict: true, allowPositionals: false });
    const strings: ParsedFlags["strings"] = {};
    const booleans: ParsedFlags["booleans"] = {};
    for (const k of spec.strings ?? []) strings[k] = typeof values[k] === "string" ? (values[k] as string) : undefined;
    for (const k of spec.booleans ?? []) booleans[k] = values[k] === true;
    return { strings, booleans };
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message.split("\n")[0] : "invalid arguments");
  }
}

import { describe, expect, it } from "vitest";
import { proposalFixtures, sampleErrorEvent, sampleStreamEvents } from "../../../lib/contracts/fixtures";
import {
  COPILOT_DATA_PART_NAMES,
  CopilotStreamEventSchema,
  copilotDataPartSchemas,
  copilotDataPartType,
  type CopilotDataStreamEvent,
  type CopilotUIMessage,
  type CopilotUIMessageChunk,
} from "../../../lib/contracts/stream";

// Compile-time contract with the AI SDK: every data event is a valid UI-message chunk,
// and a data part in a CopilotUIMessage carries the typed payload.
function asChunk(e: CopilotDataStreamEvent): CopilotUIMessageChunk {
  return e;
}
const typedPart: CopilotUIMessage["parts"][number] = {
  type: "data-step",
  id: "collect",
  data: { id: "collect", label: "x", status: "running" },
};

describe("copilot stream contract", () => {
  it("parses every event of the sample run", () => {
    for (const e of sampleStreamEvents) {
      const r = CopilotStreamEventSchema.safeParse(e);
      expect(r.success, `${e.type}: ${r.success ? "" : r.error.issues[0]?.message}`).toBe(true);
    }
    expect(CopilotStreamEventSchema.safeParse(sampleErrorEvent).success).toBe(true);
  });

  it("names data parts data-<name> for exactly the schema keys", () => {
    expect([...COPILOT_DATA_PART_NAMES].sort()).toEqual(Object.keys(copilotDataPartSchemas).sort());
    expect(COPILOT_DATA_PART_NAMES).toEqual(
      expect.arrayContaining(["step", "observation", "finding", "proposal", "execution", "verification", "incident", "error"]),
    );
    expect(copilotDataPartType("finding")).toBe("data-finding");
    for (const e of sampleStreamEvents) {
      if (e.type === "text-delta") continue;
      expect(COPILOT_DATA_PART_NAMES).toContain(e.type.slice("data-".length));
      expect(asChunk(e).type).toBe(e.type);
    }
    expect(typedPart.type).toBe("data-step");
  });

  it("rejects unknown event types and malformed payloads", () => {
    expect(CopilotStreamEventSchema.safeParse({ type: "data-shell", data: { cmd: "rm -rf /" } }).success).toBe(false);
    expect(CopilotStreamEventSchema.safeParse({ type: "tool-input-available", toolName: "delete_app" }).success).toBe(false);
    expect(CopilotStreamEventSchema.safeParse({ type: "data-step", data: { id: "s", label: "x", status: "weird" } }).success).toBe(false);
    expect(CopilotStreamEventSchema.safeParse({ type: "text-delta", delta: "x" }).success).toBe(false);
    expect(CopilotStreamEventSchema.safeParse({ type: "data-error", data: { code: "x", messageFa: "" } }).success).toBe(false);
  });

  it("a proposal part cannot smuggle an approval token or an AI-sourced delete", () => {
    const withToken = { type: "data-proposal", data: { ...proposalFixtures.proposed, approvalToken: "v1.a.b" } };
    expect(CopilotStreamEventSchema.safeParse(withToken).success).toBe(false);
    const aiDelete = {
      type: "data-proposal",
      data: { ...proposalFixtures.proposed, type: "delete_app", params: { type: "delete_app", app: "broken-shop" }, reversible: "no" },
    };
    expect(CopilotStreamEventSchema.safeParse(aiDelete).success).toBe(false);
  });
});

// Guard: user/log/LLM text is rendered through React text nodes or components/copilot/safe-markdown only.
import { describe, expect, it } from "vitest";
import { findAll, listFiles, read, stripComments } from "./scan";

describe("no raw HTML injection", () => {
  it("dangerouslySetInnerHTML is not used in app/, components/ or lib/", () => {
    const hits = listFiles(["app", "components", "lib"], [".ts", ".tsx"]).flatMap((f) =>
      findAll(f, stripComments(read(f)), /dangerouslySetInnerHTML/g),
    );
    expect(hits, "Render text as React children (or SafeMarkdown). Offending uses:").toEqual([]);
  });

  it("no innerHTML / outerHTML / insertAdjacentHTML / document.write assignments in client code", () => {
    const hits = listFiles(["app", "components", "lib"], [".ts", ".tsx"]).flatMap((f) =>
      findAll(f, stripComments(read(f)), /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/g),
    );
    expect(hits).toEqual([]);
  });
});

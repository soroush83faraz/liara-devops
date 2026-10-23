import { portFromDockerfile } from "../ports";
import { newFinding, type Dir, type Finding } from "./common";

export function detectDocker(d: Dir): Finding | undefined {
  if (!d.has("Dockerfile")) return undefined;
  const f = newFinding("docker", 0.97);
  f.reasons.push({ code: "dockerfile", file: "Dockerfile" });
  const text = d.read("Dockerfile") ?? "";
  const port = portFromDockerfile(text);
  if (port) {
    f.port = { value: port, source: "dockerfile" };
    f.reasons.push({ code: "dockerfile_expose", file: "Dockerfile", detail: String(port) });
  }
  const cmd = /^\s*(?:CMD|ENTRYPOINT)\s+(.+)$/im.exec(text)?.[1];
  if (cmd) f.startCommand = cmd.trim().slice(0, 200);
  return f;
}

/** A project with only HTML at the root and no manifest. */
export function detectStatic(d: Dir): Finding | undefined {
  const names = d.list();
  if (!names.some((n) => n.toLowerCase() === "index.html")) return undefined;
  const f = newFinding("static", 0.6);
  f.staticSite = true;
  f.reasons.push({ code: "static_index_html", file: "index.html" });
  return f;
}

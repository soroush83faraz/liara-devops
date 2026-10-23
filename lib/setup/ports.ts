// Port and bind-address heuristics over small, untrusted text files. Regex only; nothing is executed.
const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;
const num = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return valid(n) ? n : undefined;
};

/** Port a JS/TS server listens on: `process.env.PORT || 3000`, `const PORT = 4000`, `.listen(8080`. */
export function portFromJsCode(text: string): number | undefined {
  const src = text.slice(0, 512 * 1024);
  const env = /process\.env\.PORT\)?\s*(?:\|\||\?\?)\s*(\d{2,5})/.exec(src);
  if (env) return num(env[1]);
  const envPlain = /process\.env\[?['"]?PORT['"]?\]?\)?\s*(?:\|\||\?\?)\s*['"]?(\d{2,5})/.exec(src);
  if (envPlain) return num(envPlain[1]);
  const named = /\b(?:const|let|var)\s+(?:PORT|port)\s*=\s*(?:Number\(|parseInt\()?\s*['"]?(\d{2,5})['"]?\s*\)?\s*[;\n]/.exec(src);
  if (named) return num(named[1]);
  const listen = /\.listen\(\s*(\d{2,5})\b/.exec(src);
  if (listen) return num(listen[1]);
  return undefined;
}

/** `--port 3000`, `-p 3000`, `--port=3000`, `PORT=3000`, `-b 0.0.0.0:8000` in an npm/Procfile script. */
export function portFromCommand(cmd: string): number | undefined {
  const c = cmd.slice(0, 1000);
  const a = /(?:--port[= ]|\s-p[= ]|\bPORT=)\s*(\d{2,5})\b/.exec(c);
  if (a) return num(a[1]);
  const bind = /(?:--bind[= ]|\s-b[= ]|runserver\s+|--listen[= ])\s*(?:[\w.\-]*:)?(\d{2,5})\b/.exec(c);
  if (bind) return num(bind[1]);
  const hostPort = /\b(?:0\.0\.0\.0|127\.0\.0\.1|localhost):(\d{2,5})\b/.exec(c);
  if (hostPort) return num(hostPort[1]);
  return undefined;
}

export function portFromPython(text: string): number | undefined {
  const src = text.slice(0, 512 * 1024);
  const run = /\.run\([^)]*\bport\s*=\s*(\d{2,5})/.exec(src);
  if (run) return num(run[1]);
  const envPort = /int\(\s*os\.(?:environ\.get|getenv)\(\s*['"]PORT['"]\s*,\s*['"]?(\d{2,5})['"]?\s*\)\s*\)/.exec(src);
  if (envPort) return num(envPort[1]);
  const bind = /bind\s*=\s*['"](?:[\w.\-]*:)?(\d{2,5})['"]/.exec(src);
  if (bind) return num(bind[1]);
  return undefined;
}

export function portFromGo(text: string): number | undefined {
  const m = /(?:ListenAndServe(?:TLS)?|net\.Listen\([^,]+,|\.Run|\.Listen)\(\s*"[\w.\-]*:(\d{2,5})"/.exec(text.slice(0, 512 * 1024));
  return num(m?.[1]);
}

export function portFromDockerfile(text: string): number | undefined {
  for (const line of text.slice(0, 64 * 1024).split(/\r?\n/)) {
    const m = /^\s*EXPOSE\s+(.+)$/i.exec(line);
    if (!m) continue;
    for (const token of m[1].split(/\s+/)) {
      const p = /^(\d{1,5})(?:\/(?:tcp|udp))?$/i.exec(token);
      if (p && valid(Number(p[1]))) return Number(p[1]);
    }
  }
  return undefined;
}

export function portFromDotnet(text: string): number | undefined {
  const m = /https?:\/\/(?:\+|\*|0\.0\.0\.0|localhost):(\d{2,5})/.exec(text.slice(0, 256 * 1024));
  return num(m?.[1]);
}

/** True when code binds only to loopback, which is unreachable from Liara's router. */
export function bindsLocalhostOnly(text: string): boolean {
  const src = text.slice(0, 512 * 1024);
  if (/\.listen\(\s*[\w.]+\s*,\s*['"](?:localhost|127\.0\.0\.1)['"]/.test(src)) return true;
  if (/\bhost\s*[:=]\s*['"](?:localhost|127\.0\.0\.1)['"]/.test(src) && /\.listen\(/.test(src)) return true;
  if (/\.run\([^)]*\bhost\s*=\s*['"](?:localhost|127\.0\.0\.1)['"]/.test(src)) return true;
  if (/(?:--bind[= ]|\s-b\s+|runserver\s+)\s*(?:localhost|127\.0\.0\.1)\b/.test(src)) return true;
  return false;
}

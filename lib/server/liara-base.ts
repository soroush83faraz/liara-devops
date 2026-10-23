// Base URL of the Liara API. `LIARA_API_BASE_URL` exists ONLY so tests/e2e can point the server at a local fake
// Liara. Every request through this base carries the user's Liara token, so the override is:
//  - ignored entirely in production builds (a stray env var can never redirect a token), and
//  - accepted in every other environment ONLY for a loopback host (127.0.0.1, localhost, [::1]) over http(s),
//    without credentials; any other value (a remote https host included) falls back to the real API.
const DEFAULT_BASE = "https://api.liara.ir";
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function liaraBaseUrl(): string {
  const override = process.env.LIARA_API_BASE_URL;
  if (!override || process.env.NODE_ENV === "production") return DEFAULT_BASE;
  let url: URL;
  try {
    url = new URL(override.trim());
  } catch {
    return DEFAULT_BASE;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_BASE;
  if (url.username !== "" || url.password !== "") return DEFAULT_BASE;
  // WHATWG URL normalises the host (lowercase, IPv4 shorthand like 127.1, brackets kept for IPv6).
  if (!LOOPBACK_HOSTS.has(url.hostname)) return DEFAULT_BASE;
  return url.origin;
}

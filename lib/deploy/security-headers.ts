// Security headers for next.config.ts. Pure string builders so the invariants are unit-testable.
// next.config.ts imports this file by relative path (no "@/" alias is available there).

export interface HeaderPair {
  key: string;
  value: string;
}

/**
 * script-src keeps 'unsafe-inline' because Next.js emits inline bootstrap/RSC payload scripts and this app does
 * not use per-request nonces (nonces would force every page dynamic and defeat cacheComponents). 'unsafe-eval' is
 * added in development only (React/Turbopack debugging and HMR). style-src needs 'unsafe-inline' for Next/Tailwind
 * style tags and React inline style attributes.
 */
export function buildCsp(production: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(production ? [] : ["'unsafe-eval'"])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(production ? [] : ["ws:", "wss:"])],
    ...(production ? {} : { "worker-src": ["'self'", "blob:"] }),
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (production) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function buildSecurityHeaders(production: boolean): HeaderPair[] {
  const headers: HeaderPair[] = [
    { key: "Content-Security-Policy", value: buildCsp(production) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (production) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}

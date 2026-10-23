import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./lib/deploy/security-headers";

const production = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Liara's `next` platform runs the standalone server. Setting it here (instead of letting Liara patch the config)
  // avoids "Could not modify config file" for a next.config.ts.
  output: "standalone",
  poweredByHeader: false,
  // No request body limit is configured here: Next only buffers bodies for proxy/middleware (not used), and the
  // Setup/Deploy upload routes enforce their own streaming size caps.
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders(production) }];
  },
};

export default nextConfig;

import type { MetadataRoute } from "next";

/** Private operations tool: nothing here should be crawled or indexed. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

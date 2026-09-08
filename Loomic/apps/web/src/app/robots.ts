// app/robots.ts — generate robots.txt that points to the sitemap.
import type { MetadataRoute } from "next";

// Static export compatibility — force build-time generation.
export const dynamic = "force-static";

const SITE_URL =
  process.env.NEXT_PUBLIC_WEB_ORIGIN ?? "https://helstera.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/", // never index API responses
          "/home", // workspace is auth-gated
          "/projects", // private user data
          "/brand-kit",
          "/skills",
          "/team",
          "/settings",
          "/ecom-images", // workspace is auth-gated
          "/canvas", // private canvas
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

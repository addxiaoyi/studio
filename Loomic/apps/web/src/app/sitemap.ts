// app/sitemap.ts — auto-generate sitemap.xml at build time.
// Pairs with robots.ts to control which routes search engines can index.
import type { MetadataRoute } from "next";

// sitemap.xml is generated once at build time — explicitly opt out of
// dynamic rendering to keep static export happy.
export const dynamic = "force-static";

const SITE_URL =
  process.env.NEXT_PUBLIC_WEB_ORIGIN ?? "https://helstera.com";

// Routes that exist in the static export. Edit when adding new pages.
const STATIC_ROUTES = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/security", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/contact-sales", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/login", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/register", priority: 0.7, changeFrequency: "monthly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}

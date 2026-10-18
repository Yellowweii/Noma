import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/about", "/privacy", "/terms"].map((pathname) => ({
    url: new URL(pathname, SITE_URL).toString(),
  }));
}

import type { Metadata } from "next";

export const SITE_URL = "https://noma-ai.cloud";

/** Public pages opt in to indexing; application pages inherit noindex. */
export function publicPageMetadata(
  title: string,
  description: string,
  pathname: string,
): Metadata {
  const url = new URL(pathname, SITE_URL).toString();
  const images = [{
    url: "/videos/noma-promo-poster.jpg",
    alt: "Noma，让家越来越懂你",
  }];

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "Noma",
      url,
      title,
      description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images,
    },
  };
}

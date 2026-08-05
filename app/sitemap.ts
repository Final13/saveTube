import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/download-link/`, lastModified, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/manual/`, lastModified, changeFrequency: "yearly", priority: 0.6 },
    { url: `${SITE_URL}/privacy-policy/`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/agreement/`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}

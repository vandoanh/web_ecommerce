import type { Metadata } from "next";

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
};

export function createPageMetadata({ title, description, path, noIndex }: PageMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: { type: "website", title, description, url: path },
    twitter: { card: "summary", title, description },
  };
}

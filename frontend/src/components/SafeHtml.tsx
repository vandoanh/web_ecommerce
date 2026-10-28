"use client";

import DOMPurify from "dompurify";
import { useMemo } from "react";

type SafeHtmlProps = {
  html: string;
  className?: string;
};

export function SafeHtml({ html, className }: SafeHtmlProps) {
  const safeHtml = useMemo(() => DOMPurify.sanitize(html), [html]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

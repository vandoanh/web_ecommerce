"use client";

import DOMPurify from "dompurify";
import { useEffect, useState } from "react";

type SafeHtmlProps = {
  html: string;
  className?: string;
};

export function SafeHtml({ html, className }: SafeHtmlProps) {
  const [safeHtml, setSafeHtml] = useState("");

  useEffect(() => {
    setSafeHtml(DOMPurify.sanitize(html));
  }, [html]);

  return <div className={className} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

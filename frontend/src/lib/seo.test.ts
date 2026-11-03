import { describe, expect, it } from "vitest";
import { createPageMetadata } from "./seo";

describe("page metadata", () => {
  it("indexes public pages and sets canonical/open graph data", () => {
    expect(
      createPageMetadata({
        title: "Thực đơn",
        description: "Món ngon",
        path: "/products",
      }),
    ).toMatchObject({
      title: "Thực đơn",
      description: "Món ngon",
      alternates: { canonical: "/products" },
      robots: { index: true, follow: true },
      openGraph: { type: "website", title: "Thực đơn", description: "Món ngon", url: "/products" },
      twitter: { card: "summary", title: "Thực đơn", description: "Món ngon" },
    });
  });

  it("marks account pages as no-index", () => {
    expect(
      createPageMetadata({
        title: "Đơn hàng",
        description: "Đơn hàng của tôi",
        path: "/orders",
        noIndex: true,
      }).robots,
    ).toEqual({ index: false, follow: false });
  });
});

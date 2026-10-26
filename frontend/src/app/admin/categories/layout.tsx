import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Quản lý danh mục",
  description: "Tổ chức danh mục giò chả, pa-tê và các sản phẩm trong cửa hàng Tuấn Khang.",
  path: "/admin/categories",
  noIndex: true,
});

export default function AdminCategoriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}

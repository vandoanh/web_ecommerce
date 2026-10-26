import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Thêm danh mục",
  description: "Tạo danh mục mới cho cửa hàng Tuấn Khang.",
  path: "/admin/categories/create",
  noIndex: true,
});

export default function CreateCategoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}

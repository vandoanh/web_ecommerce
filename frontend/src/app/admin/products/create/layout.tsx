import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Thêm sản phẩm",
  description: "Tạo sản phẩm mới cho cửa hàng Tuấn Khang.",
  path: "/admin/products/create",
  noIndex: true,
});

export default function CreateProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}

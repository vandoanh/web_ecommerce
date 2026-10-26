import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Quản lý sản phẩm",
  description: "Quản lý danh sách, giá bán, tồn kho và thông tin sản phẩm của cửa hàng Tuấn Khang.",
  path: "/admin/products",
  noIndex: true,
});

export default function AdminProductsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

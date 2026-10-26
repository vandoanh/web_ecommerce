import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Đăng nhập quản trị",
  description: "Đăng nhập khu vực quản trị cửa hàng Tuấn Khang.",
  path: "/admin/login",
  noIndex: true,
});

export default function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}

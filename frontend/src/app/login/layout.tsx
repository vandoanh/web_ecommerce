import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Đăng nhập khách hàng",
  description: "Đăng nhập tài khoản Tuấn Khang để đặt hàng và theo dõi đơn hàng của bạn.",
  path: "/login",
  noIndex: true,
});

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}

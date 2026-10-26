import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Tạo tài khoản khách hàng",
  description: "Đăng ký tài khoản Tuấn Khang miễn phí để đặt mua giò chả, pa-tê và theo dõi đơn hàng.",
  path: "/register",
  noIndex: true,
});

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}

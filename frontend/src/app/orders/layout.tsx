import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Đơn hàng của tôi",
  description: "Xem trạng thái và thông tin các đơn hàng Tuấn Khang của bạn.",
  path: "/orders",
  noIndex: true,
});

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return children;
}

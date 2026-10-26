import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Liên hệ",
  description:
    "Gửi họ tên, số điện thoại, địa chỉ và vị trí Google Maps để Tuấn Khang liên hệ tư vấn và giao hàng.",
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Quản trị cửa hàng", template: "%s | Admin Tuấn Khang" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}

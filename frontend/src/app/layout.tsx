import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "antd/dist/reset.css";
import "./globals.css";
import { AppProviders } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Giò chả & pa-tê truyền thống | Tuấn Khang",
    template: "%s | Tuấn Khang",
  },
  description:
    "Khám phá giò lụa, giò bò, chả quế và pa-tê Tuấn Khang. Chọn món ngon truyền thống, đặt hàng trực tuyến và giao tận nhà.",
  alternates: { canonical: "/" },
  icons: { icon: "/logotk.png", apple: "/logotk.png" },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: "Tuấn Khang",
    url: "/",
    title: "Giò chả & pa-tê truyền thống | Tuấn Khang",
    description: "Món ngon truyền thống, đặt hàng trực tuyến và giao tận nhà.",
    images: ["/logotk.png"],
  },
  twitter: {
    card: "summary",
    title: "Giò chả & pa-tê truyền thống | Tuấn Khang",
    description: "Món ngon truyền thống, đặt hàng trực tuyến và giao tận nhà.",
    images: ["/logotk.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <AntdRegistry>
          <AppProviders>{children}</AppProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}

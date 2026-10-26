import type { Metadata } from "next";
import { productIdFromSlug, productSlug } from "@/lib/product-url";
import type { Product } from "@/lib/store";

type ProductRouteProps = { children: React.ReactNode; params: Promise<{ slug: string }> };

const apiBase = process.env.API_INTERNAL_URL ?? "http://localhost:8080";

function fallbackTitle(slug: string) {
  return slug
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("vi") + word.slice(1))
    .join(" ") || "Chi tiết sản phẩm";
}

export async function generateMetadata({ params }: ProductRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const productId = productIdFromSlug(slug);
  if (productId === null) {
    return { title: "Không tìm thấy sản phẩm", robots: { index: false, follow: false } };
  }

  try {
    const response = await fetch(`${apiBase}/api/v1/products/${productId}`, { cache: "no-store" });
    if (!response.ok) {
      return { title: "Không tìm thấy sản phẩm", robots: { index: false, follow: false } };
    }

    const product = (await response.json()) as Product;
    const canonical = `/products/${productSlug(product)}`;
    const description =
      product.description?.trim() ||
      `Đặt mua ${product.name} từ Tuấn Khang, đặc sản giò chả và pa-tê truyền thống giao tận nhà.`;
    const image = product.imageUrl || "/logotk.png";

    return {
      title: `${product.name} – ${new Intl.NumberFormat("vi-VN").format(product.priceVnd)}₫`,
      description: description.slice(0, 160),
      alternates: { canonical },
      openGraph: {
        type: "website",
        title: product.name,
        description: description.slice(0, 200),
        url: canonical,
        images: [{ url: image, alt: product.name }],
      },
      twitter: {
        card: "summary_large_image",
        title: product.name,
        description: description.slice(0, 200),
        images: [image],
      },
    };
  } catch {
    return {
      title: fallbackTitle(slug),
      description: `Thông tin chi tiết ${fallbackTitle(slug)} và các món ngon truyền thống tại Tuấn Khang.`,
      alternates: { canonical: `/products/${slug}` },
    };
  }
}

export default function ProductLayout({ children }: ProductRouteProps) {
  return children;
}

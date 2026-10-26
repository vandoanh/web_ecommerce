"use client";

import Image from "next/image";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { SafeHtml } from "@/components/SafeHtml";
import { ClientMenu } from "@/components/ClientMenu";
import { SharedFooter, SharedHeader } from "@/components/SharedChrome";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadStoreCart } from "@/lib/cart";
import { productIdFromSlug, productSlug } from "@/lib/product-url";
import { storeApi, type CartItem, type Product } from "@/lib/store";
import "../../store.css";

const money = (amount: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [cartId, setCartId] = useState("");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let canceled = false;
    const productId = productIdFromSlug(slug);
    if (productId === null) {
      queueMicrotask(() => {
        if (canceled) return;
        setError("Không tìm thấy sản phẩm.");
        setLoading(false);
      });
      return () => {
        canceled = true;
      };
    }
    Promise.all([storeApi.product(productId), loadStoreCart()])
      .then(([item, cart]) => {
        if (canceled) return;
        setProduct(item);
        setActiveImage(0);
        const canonicalSlug = productSlug(item);
        if (slug !== canonicalSlug) router.replace(`/products/${canonicalSlug}`, { scroll: false });
        setCartId(cart.cartId);
        setCartItems(cart.items);
      })
      .catch((reason: unknown) => {
        if (!canceled)
          setError(reason instanceof Error ? reason.message : "Không tải được sản phẩm.");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [router, slug]);

  async function addToCart(buyNow = false) {
    if (!product || !cartId || product.stock < 1) return;
    setSaving(true);
    setError("");
    setNotice("");
    const existing = cartItems.find((item) => item.productId === product.id);
    const nextQuantity = Math.min(product.stock, 99, (existing?.quantity ?? 0) + quantity);
    const nextItems = existing
      ? cartItems.map((item) =>
          item.productId === product.id ? { ...item, quantity: nextQuantity } : item,
        )
      : [...cartItems, { productId: product.id, quantity: nextQuantity }];
    try {
      const saved = await storeApi.saveCart(cartId, nextItems);
      setCartItems(saved.items);
      if (buyNow) router.push("/?checkout=1");
      else setNotice(`Đã thêm ${product.name} vào giỏ hàng.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được giỏ hàng.");
    } finally {
      setSaving(false);
    }
  }

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const productImages = product
    ? Array.from(new Set([product.imageUrl, ...(product.images ?? [])].filter(Boolean)))
    : [];

  return (
    <main className="store-page store-product-detail-page">
      <SharedHeader className="store-home-header store-detail-header" brandClassName="store-home-brand" logoClassName="store-home-logo" brandSize={72}>
        <ClientMenu />
        <Link className="store-home-cart" href="/">
          <span aria-hidden="true">♧</span> Giỏ hàng <b>{cartCount}</b>
        </Link>
      </SharedHeader>

      <div className="store-product-detail-shell">
        <nav className="store-product-breadcrumb" aria-label="Đường dẫn">
          <Link href="/">Trang chủ</Link>
          <span>/</span>
          <Link href="/#products">Thực đơn</Link>
          {product && (
            <>
              <span>/</span>
              <span>{product.name}</span>
            </>
          )}
        </nav>
        {loading ? (
          <p className="store-empty">Đang tải thông tin sản phẩm…</p>
        ) : product ? (
          <section className="store-product-detail">
            <div className="store-product-detail-gallery">
            <div className="store-product-detail-image">
              <Image
                src={productImages[activeImage] ?? product.imageUrl}
                alt={product.name}
                width={1000}
                height={1000}
                unoptimized
                priority
              />
              <span>
                {product.name.toLowerCase().includes("pa-tê") ? "PA-TÊ" : "ĐẶC SẢN TUẤN KHANG"}
              </span>
              {productImages.length > 1 && (
                <>
                  <button
                    className="store-gallery-arrow previous"
                    type="button"
                    aria-label="Ảnh trước"
                    onClick={() => setActiveImage((index) => (index - 1 + productImages.length) % productImages.length)}
                  >
                    ‹
                  </button>
                  <button
                    className="store-gallery-arrow next"
                    type="button"
                    aria-label="Ảnh tiếp theo"
                    onClick={() => setActiveImage((index) => (index + 1) % productImages.length)}
                  >
                    ›
                  </button>
                  <span className="store-gallery-count">{activeImage + 1} / {productImages.length}</span>
                </>
              )}
            </div>
            {productImages.length > 1 && (
              <div className="store-product-thumbnails" aria-label="Ảnh sản phẩm">
                {productImages.map((image, index) => (
                  <button
                    key={`${image}-${index}`}
                    type="button"
                    aria-label={`Xem ảnh ${index + 1}`}
                    aria-pressed={activeImage === index}
                    className={activeImage === index ? "active" : ""}
                    onClick={() => setActiveImage(index)}
                  >
                    <Image src={image} alt="" width={100} height={80} unoptimized />
                  </button>
                ))}
              </div>
            )}
            </div>
            <div className="store-product-detail-copy">
              <span className="store-kicker">MÓN NGON MỖI NGÀY</span>
              <h1>{product.name}</h1>
              <p className="store-product-detail-sku">Mã sản phẩm: {product.sku}</p>
              {product.categories?.length > 0 && (
                <div className="store-product-detail-categories" aria-label="Danh mục sản phẩm">
                  {product.categories.map((category) => (
                    <span key={category.id}>{category.name}</span>
                  ))}
                </div>
              )}
              <strong className="store-product-detail-price">{money(product.priceVnd)}</strong>
              <p className="store-product-detail-stock">
                {product.stock > 0 ? `Còn ${product.stock} sản phẩm` : "Tạm hết hàng"}
              </p>
              {product.description ? (
                <SafeHtml className="store-product-detail-description" html={product.description} />
              ) : (
                <p className="store-product-detail-description">Món ngon truyền thống, thích hợp cho bữa cơm gia đình.</p>
              )}
              <div className="store-product-detail-quantity">
                <span>Số lượng</span>
                <div>
                  <button
                    type="button"
                    aria-label="Giảm số lượng"
                    onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  >
                    −
                  </button>
                  <b>{quantity}</b>
                  <button
                    type="button"
                    aria-label="Tăng số lượng"
                    onClick={() => setQuantity((value) => Math.min(99, product.stock, value + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="store-product-detail-actions">
                <button
                  className="store-add-button"
                  type="button"
                  disabled={saving || product.stock < 1}
                  onClick={() => void addToCart()}
                >
                  {saving ? "Đang lưu…" : "Thêm vào giỏ"}
                </button>
                <button
                  className="store-submit-order"
                  type="button"
                  disabled={saving || product.stock < 1}
                  onClick={() => void addToCart(true)}
                >
                  Mua ngay
                </button>
              </div>
              {notice && (
                <p className="store-message store-success" role="status">
                  {notice}
                </p>
              )}
              {error && (
                <p className="store-message store-error" role="alert">
                  {error}
                </p>
              )}
              <div className="store-product-detail-note">
                <span>✿</span> Đặc sản quen thuộc, thêm tròn vị bữa cơm nhà.
              </div>
            </div>
          </section>
        ) : (
          <section className="store-product-not-found">
            <span className="store-kicker">TUẤN KHANG</span>
            <h1>Không tìm thấy sản phẩm</h1>
            <p>{error || "Sản phẩm này hiện không còn trong thực đơn."}</p>
            <Link className="store-submit-order" href="/#products">
              Quay lại thực đơn
            </Link>
          </section>
        )}
      </div>
      <SharedFooter className="store-footer store-home-footer">
        <Link className="store-brand" href="/">
          <BrandLogo size={64} className="store-footer-logo" />
        </Link>
        <span>Thêm món ngon, ấm vị bữa cơm nhà.</span>
        <Link href="/#products">Xem thực đơn</Link>
      </SharedFooter>
    </main>
  );
}

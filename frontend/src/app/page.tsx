"use client";

import Link from "next/link";
import Image from "next/image";
import { BrandLogo } from "@/components/BrandLogo";
import { SafeHtml } from "@/components/SafeHtml";
import { ClientMenu } from "@/components/ClientMenu";
import { productHref } from "@/lib/product-url";
import { SharedFooter, SharedHeader } from "@/components/SharedChrome";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { loadStoreCart } from "@/lib/cart";
import { storeApi, type Category, type Product } from "@/lib/store";
import "./store.css";

const money = (amount: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

export default function StorefrontPage() {
  const { token, ready, logout } = useAuth({ storageKey: "store-token", logoutTo: "/" });
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [cartId, setCartId] = useState("");
  const [cartReady, setCartReady] = useState(false);
  const [cartUnavailable, setCartUnavailable] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [category, setCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const cart = useMemo(
    () => products.filter((product) => (quantities[product.id] ?? 0) > 0),
    [products, quantities],
  );
  const total = cart.reduce((sum, product) => sum + product.priceVnd * quantities[product.id], 0);
  const cartCount = cart.reduce((count, product) => count + quantities[product.id], 0);
  const menuProducts = products.filter((product) => {
    if (category === null) return true;
    return product.categories?.some((item) => item.id === category) ?? false;
  });

  useEffect(() => {
    let canceled = false;
    async function loadCart() {
      try {
        const saved = await loadStoreCart();
        if (!canceled) {
          setCartId(saved.cartId);
          setQuantities(
            Object.fromEntries(saved.items.map((item) => [item.productId, item.quantity])),
          );
          if (new URLSearchParams(window.location.search).get("checkout") === "1") {
            setShowCheckout(true);
            window.history.replaceState({}, "", window.location.pathname);
          }
          setCartReady(true);
        }
      } catch (reason) {
        if (!canceled) {
          setCartUnavailable(true);
          setCartReady(true);
          setError(reason instanceof Error ? reason.message : "Không tải được giỏ hàng từ Redis.");
        }
      }
    }
    void loadCart();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!cartReady || !cartId || cartUnavailable) return;
    const items = Object.entries(quantities)
      .map(([productId, quantity]) => ({ productId: Number(productId), quantity }))
      .filter((item) => item.quantity > 0);
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(() => storeApi.saveCart(cartId, items))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Không lưu được giỏ hàng vào Redis.");
      });
  }, [cartId, cartReady, cartUnavailable, quantities]);

  useEffect(() => {
    Promise.all([storeApi.products(), storeApi.categories()])
      .then(([productList, categoryList]) => {
        setProducts(productList.items);
        setCategories(categoryList.items);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Không tải được sản phẩm."),
      )
      .finally(() => setLoading(false));
  }, []);

  async function checkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    setError("");
    setNotice("");
    try {
      await saveQueue.current;
      const order = await storeApi.createOrder(token, {
        recipientName: String(form.get("recipientName")),
        phone: String(form.get("phone")),
        shippingAddress: String(form.get("shippingAddress")),
        items: cart.map((product) => ({ productId: product.id, quantity: quantities[product.id] })),
      });
      setQuantities({});
      setShowCheckout(false);
      setNotice(`Đặt hàng thành công. Mã đơn hàng: ${order.orderNumber}`);
      await storeApi.clearCart(cartId).catch(() => {
        setError("Đơn đã được tạo nhưng chưa thể xóa giỏ hàng trên Redis.");
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể đặt hàng.");
    }
  }

  function changeQuantity(product: Product, delta: number) {
    setQuantities((current) => {
      const next = Math.min(99, product.stock, Math.max(0, (current[product.id] ?? 0) + delta));
      return { ...current, [product.id]: next };
    });
  }

  return (
    <main className="store-page store-home">
      <div className="store-topbar">
        <span>ĐẶC SẢN GIÒ CHẢ &amp; PA-TÊ · HƯƠNG VỊ QUEN THUỘC</span>
        <span>Đặt hàng trực tuyến · Giao tận nhà</span>
      </div>
      <SharedHeader
        className="store-home-header"
        brandClassName="store-home-brand"
        logoClassName="store-home-logo"
        brandSize={72}
      >
        <ClientMenu current="home" onHomePage />
        <div className="store-home-account">
          {ready && token ? (
            <>
              <button
                className="store-home-cart"
                disabled={!cartReady || cartUnavailable}
                onClick={() => setShowCheckout(true)}
              >
                <span aria-hidden="true">♧</span> Giỏ hàng <b>{cartCount}</b>
              </button>
              <Link className="store-home-account-link" href="/orders">
                Đơn hàng
              </Link>
              <button className="store-home-account-link" onClick={logout}>
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <button
                className="store-home-cart"
                disabled={!cartReady || cartUnavailable}
                onClick={() => setShowCheckout(true)}
              >
                <span aria-hidden="true">♧</span> Giỏ hàng <b>{cartCount}</b>
              </button>
              <Link className="store-home-account-link" href="/login">
                Đăng nhập
              </Link>
              <Link className="store-home-account-join" href="/register">
                Tài khoản
              </Link>
            </>
          )}
        </div>
      </SharedHeader>

      <section className="store-hero store-foodix-hero" id="home">
        <div className="store-hero-copy">
          <span className="store-kicker">HƯƠNG VỊ TRUYỀN THỐNG · CHỌN MÓN NGON</span>
          <h1>
            Giò chả thơm ngon,
            <br />
            <em>trọn vị bữa cơm nhà.</em>
          </h1>
          <p>
            Thưởng thức giò lụa, giò bò, chả quế và pa-tê — những món ngon thân thuộc cho mâm cơm
            gia đình.
          </p>
          <div className="store-hero-actions">
            <a className="store-hero-button" href="#products">
              Khám phá thực đơn <span>↗</span>
            </a>
            <span className="store-hero-note">
              <b>✳</b> Gói trọn vị ngon mỗi ngày
            </span>
          </div>
          <div className="store-hero-rating">
            <span className="store-rating-mark">✳</span>
            <span>Giò lụa · Giò bò · Chả quế · Pa-tê</span>
          </div>
        </div>
        <div className="store-hero-visual" aria-label="Món ăn đặc sản giò chả">
          <div className="store-hero-image-wrap">
            <Image
              src="https://images.unsplash.com/photo-1544025162-d76694265947?w=1000&auto=format&fit=crop&q=85"
              alt="Mâm món ăn nóng hổi cho bữa cơm gia đình"
              width={1000}
              height={1000}
              priority
              unoptimized
            />
          </div>
          <div className="store-hero-seal">
            <span>VỊ NGON</span>
            <b>
              TỪ
              <br />
              TÂM
            </b>
          </div>
          <div className="store-hero-floating">
            <span>GỢI Ý HÔM NAY</span>
            <b>
              Giò lụa
              <br />
              truyền thống
            </b>
            <i>145.000₫</i>
          </div>
          <span className="store-hero-spark store-hero-spark-one">✳</span>
          <span className="store-hero-spark store-hero-spark-two">✦</span>
        </div>
      </section>

      <section className="store-benefits" aria-label="Điểm nổi bật">
        <article>
          <span>♨</span>
          <div>
            <b>Đậm đà vị truyền thống</b>
            <small>Món ngon quen thuộc mỗi ngày</small>
          </div>
        </article>
        <article>
          <span>✿</span>
          <div>
            <b>Chọn món dễ dàng</b>
            <small>Giò chả và pa-tê trong một nơi</small>
          </div>
        </article>
        <article>
          <span>⌂</span>
          <div>
            <b>Đặt hàng tiện lợi</b>
            <small>Giao đến tận nhà bạn</small>
          </div>
        </article>
      </section>

      <section className="store-catalog store-menu-section" id="products">
        <div className="store-menu-heading">
          <div>
            <span className="store-kicker">MÓN NGON MỖI NGÀY</span>
            <h2>
              Thực đơn <em>nhà làm</em>
            </h2>
            <p>Chọn món yêu thích để bữa cơm thêm đủ đầy.</p>
          </div>
          <div className="store-menu-tabs" aria-label="Lọc theo loại món">
            {[{ id: null, name: "Tất cả món" }, ...categories].map((item) => (
              <button
                className={category === item.id ? "active" : ""}
                key={item.id ?? "all"}
                onClick={() => setCategory(item.id)}
                type="button"
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p className="store-message store-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="store-message store-success" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <p className="store-empty">Đang tải thực đơn…</p>
        ) : (
          <div className="store-products store-menu-grid">
            {menuProducts.map((product) => (
              <article className="store-product-card store-menu-card" key={product.id}>
                <Link
                  className="store-product-detail-link"
                  href={productHref(product)}
                  aria-label={`Xem chi tiết ${product.name}`}
                >
                  <div className="store-product-image">
                    <Image
                      src={product.imageUrl}
                      alt={product.name}
                      width={640}
                      height={640}
                      unoptimized
                    />
                    <span className="store-product-tag">
                      {product.name.toLowerCase().includes("pa-tê") ? "PA-TÊ" : "ĐẶC SẢN"}
                    </span>
                    <span className="store-stock-tag">CÒN {product.stock}</span>
                  </div>
                </Link>
                <div className="store-product-info">
                  <small>{product.sku}</small>
                  <h3>
                    <Link className="store-product-detail-link" href={productHref(product)}>
                      {product.name}
                    </Link>
                  </h3>
                  <SafeHtml className="store-product-card-description" html={product.description} />
                  <div className="store-product-bottom">
                    <strong>{money(product.priceVnd)}</strong>
                    {quantities[product.id] ? (
                      <div className="store-quantity">
                        <button
                          aria-label={`Giảm ${product.name}`}
                          onClick={() => changeQuantity(product, -1)}
                        >
                          −
                        </button>
                        <span>{quantities[product.id]}</span>
                        <button
                          aria-label={`Thêm ${product.name}`}
                          onClick={() => changeQuantity(product, 1)}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        className="store-add-button"
                        disabled={product.stock < 1 || !cartReady || cartUnavailable}
                        onClick={() => changeQuantity(product, 1)}
                      >
                        Thêm món <span>＋</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {menuProducts.length === 0 && (
              <p className="store-empty">Chưa có món trong danh mục này.</p>
            )}
          </div>
        )}
      </section>

      <section className="store-story" id="about">
        <div className="store-story-mark">TK</div>
        <div>
          <span className="store-kicker">BỮA CƠM NHÀ THÊM TRÒN VỊ</span>
          <h2>
            Món ngon thân thuộc,
            <br />
            <em>gắn kết những yêu thương.</em>
          </h2>
          <p>
            Tuấn Khang mang đến những món giò chả, pa-tê quen thuộc để bạn dễ dàng chuẩn bị bữa ăn
            ngon cho gia đình.
          </p>
          <a href="#products">
            Xem thực đơn <span>↗</span>
          </a>
        </div>
        <div className="store-story-image">
          <Image
            src="https://images.unsplash.com/photo-1547592180-85f173990554?w=900&auto=format&fit=crop&q=85"
            alt="Bữa ăn được bày biện ấm cúng"
            width={900}
            height={700}
            unoptimized
          />
          <span>
            NGON TỪ
            <br />
            BỮA CƠM NHÀ
          </span>
        </div>
      </section>

      <section className="store-order-banner">
        <div>
          <span className="store-kicker">HÔM NAY ĂN GÌ?</span>
          <h2>Chọn món ngon cho bữa cơm nhà.</h2>
        </div>
        <a href="#products">
          Đặt món ngay <span>↗</span>
        </a>
      </section>

      <SharedFooter className="store-footer store-home-footer">
        <Link className="store-brand" href="/">
          <BrandLogo size={64} className="store-footer-logo" />
        </Link>
        <span>Thêm món ngon, ấm vị bữa cơm nhà.</span>
        <Link href="/admin/login">Quản trị cửa hàng</Link>
      </SharedFooter>

      {showCheckout && (
        <div className="store-modal-backdrop" onClick={() => setShowCheckout(false)}>
          <section
            className="store-checkout"
            id="checkout"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-heading"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="store-modal-close"
              aria-label="Đóng"
              onClick={() => setShowCheckout(false)}
            >
              ×
            </button>
            <span className="store-kicker">HOÀN TẤT ĐƠN HÀNG</span>
            <h2 id="checkout-heading">Thông tin giao hàng</h2>
            {!token ? (
              <p>
                Vui lòng <Link href="/login">đăng nhập tài khoản khách hàng</Link> để đặt hàng.
              </p>
            ) : (
              <>
                <div className="store-checkout-items">
                  {cart.map((product) => (
                    <p key={product.id}>
                      <span>
                        {product.name} × {quantities[product.id]}
                      </span>
                      <strong>{money(product.priceVnd * quantities[product.id])}</strong>
                    </p>
                  ))}
                  <p className="store-checkout-total">
                    <span>Tổng cộng</span>
                    <strong>{money(total)}</strong>
                  </p>
                </div>
                <form onSubmit={checkout} className="store-checkout-form">
                  <label>
                    Người nhận
                    <input name="recipientName" required maxLength={255} />
                  </label>
                  <label>
                    Số điện thoại
                    <input name="phone" required maxLength={32} />
                  </label>
                  <label>
                    Địa chỉ giao hàng
                    <textarea name="shippingAddress" required maxLength={2000} rows={3} />
                  </label>
                  <button className="store-submit-order" type="submit" disabled={cart.length === 0}>
                    Xác nhận đặt hàng
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

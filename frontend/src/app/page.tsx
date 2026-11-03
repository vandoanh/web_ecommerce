"use client";

import Link from "next/link";
import Image from "next/image";
import { BrandLogo } from "@/components/BrandLogo";
import { SafeHtml } from "@/components/SafeHtml";
import { ClientMenu } from "@/components/ClientMenu";
import { productHref } from "@/lib/product-url";
import { SharedFooter, SharedHeader } from "@/components/SharedChrome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { loadStoreCart } from "@/lib/cart";
import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  checkoutCartMatches,
  checkoutOwnerFromToken,
  clearCheckoutAttempt,
  clearCheckoutCompletion,
  CheckoutAttemptStorageError,
  CheckoutLockUnavailableError,
  inspectCheckoutAttempt,
  runCheckoutSubmission,
  withCheckoutLock,
  type CheckoutAttemptState,
  type CheckoutSubmissionOutcome,
} from "@/lib/checkout";
import { storeApi, type Category, type CreateOrderPayload, type Product } from "@/lib/store";
import { categoryTabs, foodGroupMatchesCategory, matchingFoodGroup } from "@/lib/catalog";
import { foodPlaceholder, imageFallback } from "@/lib/image-fallback";
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
  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checkoutState, setCheckoutState] = useState<CheckoutAttemptState>({ status: "none" });
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const cart = useMemo(
    () => products.filter((product) => (quantities[product.id] ?? 0) > 0),
    [products, quantities],
  );
  const cartItems = useMemo<CreateOrderPayload["items"]>(
    () => cart.map((product) => ({ productId: product.id, quantity: quantities[product.id] })),
    [cart, quantities],
  );
  const checkoutOwner = checkoutOwnerFromToken(token);
  const refreshCheckoutState = useCallback(() => {
    const next = inspectCheckoutAttempt(checkoutOwner);
    setCheckoutState(next);
    return next;
  }, [checkoutOwner]);
  const checkoutAttempt = checkoutState.status === "owned" ? checkoutState.attempt : null;
  // Any persisted attempt, including one owned by another account, blocks new orders.
  const checkoutBlocked = checkoutState.status !== "none";
  const attemptCartChanged = checkoutAttempt
    ? !checkoutCartMatches(checkoutAttempt, cartItems)
    : false;
  const total = cart.reduce((sum, product) => sum + product.priceVnd * quantities[product.id], 0);
  const cartCount = cart.reduce((count, product) => count + quantities[product.id], 0);
  const tabs = categoryTabs(categories);
  const menuProducts = products.filter((product) => {
    if (category === null) return true;
    if (category.startsWith("group:")) {
      const groupId = category.slice("group:".length);
      return product.categories?.some((item) => foodGroupMatchesCategory(groupId, item)) ?? false;
    }
    return product.categories?.some((item) => String(item.id) === category) ?? false;
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
    if (!ready) return;
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      setCheckoutState(inspectCheckoutAttempt(checkoutOwner));
      setAbandonConfirm(false);
    });
    return () => {
      canceled = true;
    };
  }, [checkoutOwner, ready]);

  useEffect(() => {
    function syncAttempt(event: StorageEvent) {
      if (event.key !== null && event.key !== CHECKOUT_ATTEMPT_STORAGE_KEY) return;
      refreshCheckoutState();
    }
    window.addEventListener("storage", syncAttempt);
    return () => window.removeEventListener("storage", syncAttempt);
  }, [refreshCheckoutState]);

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
        setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu cửa hàng."),
      )
      .finally(() => setLoading(false));
  }, []);

  function applyCheckoutOutcome(outcome: CheckoutSubmissionOutcome) {
    switch (outcome.status) {
      case "created": {
        refreshCheckoutState();
        setAbandonConfirm(false);
        setQuantities({});
        setShowCheckout(false);
        if (outcome.reusedCompletion) {
          setNotice(
            `Đơn hàng đã được xác nhận trước đó ở một tab khác. Mã đơn hàng: ${outcome.orderNumber}`,
          );
        } else {
          setNotice(`Đặt hàng thành công. Mã đơn hàng: ${outcome.orderNumber}`);
        }
        if (outcome.storageWarning) setError(outcome.storageWarning);
        void storeApi.clearCart(cartId).catch(() => {
          setError("Đơn đã được tạo nhưng chưa thể xóa giỏ hàng trên Redis.");
        });
        break;
      }
      case "retained": {
        setCheckoutState({ status: "owned", attempt: outcome.attempt });
        if (outcome.reason === "uncertain") {
          setError(
            "Chưa xác nhận được kết quả đơn hàng. Đơn hàng và mã chống trùng đã được giữ nguyên; hãy thử lại đúng đơn cũ hoặc hủy bỏ rõ ràng trước khi đặt giỏ khác.",
          );
        } else {
          const message =
            outcome.error instanceof Error ? outcome.error.message : "Xung đột mã đơn.";
          setError(
            `${message} Hãy kiểm tra mục Đơn hàng của tôi; chỉ hủy bỏ đơn chưa rõ nếu bạn chắc chắn muốn bắt đầu lại.`,
          );
        }
        break;
      }
      case "failed": {
        refreshCheckoutState();
        const message =
          outcome.error instanceof Error ? outcome.error.message : "Không thể đặt hàng.";
        setError(outcome.storageWarning ? `${message} ${outcome.storageWarning}` : message);
        break;
      }
      case "blocked": {
        switch (outcome.reason) {
          case "owner-mismatch":
            setCheckoutState({ status: "owner-mismatch" });
            setError(
              "Trình duyệt này đang giữ một đơn chưa rõ kết quả thuộc một tài khoản khác. Nội dung đơn được ẩn để bảo vệ riêng tư; hãy kiểm tra mục Đơn hàng và chủ động hủy bỏ đơn đó trước khi đặt đơn mới.",
            );
            break;
          case "payload-changed":
            refreshCheckoutState();
            setError(
              "Giỏ hàng đã thay đổi so với đơn chưa rõ kết quả. Hãy thử lại đơn cũ hoặc hủy bỏ đơn đó trước khi đặt giỏ hiện tại.",
            );
            break;
          case "invalid-attempt":
            setCheckoutState({ status: "invalid" });
            setError(
              "Bản ghi đơn chưa rõ trên trình duyệt bị hỏng và không thể xác minh. Hệ thống không cho đặt đơn mới cho đến khi bạn chủ động xóa bản ghi đó.",
            );
            break;
          case "attempt-missing":
            refreshCheckoutState();
            setError(
              "Đơn chưa rõ kết quả không còn trong trình duyệt này. Hãy kiểm tra mục Đơn hàng trước khi đặt lại.",
            );
            break;
          case "storage-unavailable":
            setCheckoutState({ status: "unavailable", error: outcome.error });
            setError(
              "Không thể truy cập bộ nhớ cục bộ an toàn nên đơn hàng chưa được gửi. Hãy kiểm tra quyền lưu trữ của trình duyệt rồi thử lại.",
            );
            break;
          case "storage-write-failed":
            refreshCheckoutState();
            setError(
              "Không thể lưu đơn chưa rõ kết quả vào bộ nhớ trình duyệt nên đơn hàng chưa được gửi. Hãy giải phóng dung lượng lưu trữ rồi thử lại.",
            );
            break;
          case "lock-unavailable":
            setError(
              "Trình duyệt không hỗ trợ khóa đặt hàng giữa các tab. Để tránh tạo đơn trùng, hệ thống chưa gửi đơn.",
            );
            break;
        }
        break;
      }
    }
  }

  async function runExclusiveCheckout(task: () => Promise<CheckoutSubmissionOutcome>) {
    if (!token) return;
    setSubmittingOrder(true);
    setError("");
    setNotice("");
    try {
      await saveQueue.current.catch(() => undefined);
      applyCheckoutOutcome(await task());
    } catch (reason) {
      if (reason instanceof CheckoutAttemptStorageError) {
        refreshCheckoutState();
        setError(
          "Không thể lưu hoặc đọc bản ghi đơn hàng trên trình duyệt nên đơn hàng chưa được gửi.",
        );
      } else if (reason instanceof CheckoutLockUnavailableError) {
        setError(
          "Trình duyệt không hỗ trợ khóa đặt hàng giữa các tab. Để tránh tạo đơn trùng, hệ thống chưa gửi đơn.",
        );
      } else {
        setError(reason instanceof Error ? reason.message : "Không thể đặt hàng.");
      }
    } finally {
      setSubmittingOrder(false);
    }
  }

  async function checkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    const payload: CreateOrderPayload = {
      recipientName: String(form.get("recipientName")),
      phone: String(form.get("phone")),
      shippingAddress: String(form.get("shippingAddress")),
      items: cartItems,
    };
    await runExclusiveCheckout(() =>
      runCheckoutSubmission({
        owner: checkoutOwner,
        payload,
        submit: (attempt) => storeApi.createOrder(token, attempt.payload, attempt.idempotencyKey),
      }),
    );
  }

  function retryCheckoutAttempt() {
    if (!checkoutAttempt || !token) return;
    const attempt = checkoutAttempt;
    void runExclusiveCheckout(() =>
      runCheckoutSubmission({
        owner: checkoutOwner,
        payload: attempt.payload,
        mode: "retry",
        submit: (persisted) =>
          storeApi.createOrder(token, persisted.payload, persisted.idempotencyKey),
      }),
    );
  }

  async function abandonCheckoutAttempt() {
    setSubmittingOrder(true);
    setError("");
    setNotice("");
    try {
      const wasMismatched = checkoutState.status === "owner-mismatch";
      await withCheckoutLock(() => {
        clearCheckoutAttempt();
        if (!wasMismatched) clearCheckoutCompletion();
      });
      setCheckoutState({ status: "none" });
      setAbandonConfirm(false);
      setNotice(
        "Đã hủy bỏ đơn chưa rõ kết quả. Hãy kiểm tra mục Đơn hàng trước khi đặt lại để tránh trùng đơn.",
      );
    } catch (reason) {
      refreshCheckoutState();
      if (reason instanceof CheckoutLockUnavailableError) {
        setError(
          "Trình duyệt không hỗ trợ khóa đặt hàng giữa các tab nên chưa thể xóa đơn chưa rõ một cách an toàn.",
        );
      } else if (reason instanceof CheckoutAttemptStorageError) {
        setError("Không thể xóa bản ghi đơn hàng trên trình duyệt. Hãy kiểm tra quyền lưu trữ.");
      } else {
        setError(reason instanceof Error ? reason.message : "Không thể hủy bỏ đơn chưa rõ.");
      }
    } finally {
      setSubmittingOrder(false);
    }
  }

  function changeQuantity(product: Product, delta: number) {
    if (checkoutBlocked) {
      setShowCheckout(true);
      return;
    }
    setQuantities((current) => {
      const next = Math.min(99, product.stock, Math.max(0, (current[product.id] ?? 0) + delta));
      return { ...current, [product.id]: next };
    });
  }

  function abandonControls(warning: React.ReactNode) {
    if (!abandonConfirm) {
      return (
        <button
          className="store-checkout-secondary store-checkout-danger"
          type="button"
          disabled={submittingOrder}
          onClick={() => setAbandonConfirm(true)}
        >
          Hủy bỏ đơn chưa rõ
        </button>
      );
    }
    return (
      <div className="store-checkout-abandon" role="alert">
        <p>{warning}</p>
        <div className="store-checkout-actions">
          <button
            className="store-checkout-secondary store-checkout-danger"
            type="button"
            disabled={submittingOrder}
            onClick={() => void abandonCheckoutAttempt()}
          >
            Tôi hiểu, hủy bỏ và bắt đầu lại
          </button>
          <button
            className="store-checkout-secondary"
            type="button"
            disabled={submittingOrder}
            onClick={() => setAbandonConfirm(false)}
          >
            Giữ lại đơn cũ
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="store-page store-home">
      <div className="store-topbar">
        <span>TUẤN KHANG · DANH MỤC VÀ SẢN PHẨM</span>
        <span>Thanh toán khi nhận hàng (COD)</span>
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
            Bánh mì Tuấn Khang,
            <br />
            <em>cùng món ngon thân thuộc.</em>
          </h1>
          <p>
            Khám phá các sản phẩm trong danh mục Tuấn Khang. Thông tin món ăn và giá hiển thị theo
            dữ liệu cửa hàng.
          </p>
          <div className="store-hero-actions">
            <a className="store-hero-button" href="#products">
              Khám phá thực đơn <span>↗</span>
            </a>
            <span className="store-hero-note">
              <b>✳</b> Thanh toán khi nhận hàng
            </span>
          </div>
          <div className="store-hero-rating">
            <span className="store-rating-mark">✳</span>
            <span>Bánh mì · Pâté · Sốt · Giò lụa · Giò tai · Thịt nguội</span>
          </div>
        </div>
        <div className="store-hero-visual" aria-label="Hình minh họa bố cục cửa hàng">
          <div className="store-hero-image-wrap">
            <Image
              src="/food-placeholder.svg"
              alt="Ảnh minh họa thay thế — cần thay bằng ảnh sản phẩm được cấp quyền"
              width={1000}
              height={1000}
              priority
              unoptimized
            />
          </div>
          <div className="store-hero-seal">
            <span>MINH HỌA</span>
            <b>
              ẢNH
              <br />
              TÂM
            </b>
          </div>
          <div className="store-hero-floating">
            <span>ẢNH MINH HỌA</span>
            <b>
              Hình ảnh
              <br />
              thay thế
            </b>
            <i>Thay bằng ảnh được duyệt</i>
          </div>
          <span className="store-hero-spark store-hero-spark-one">✳</span>
          <span className="store-hero-spark store-hero-spark-two">✦</span>
        </div>
      </section>

      <section className="store-benefits" aria-label="Điểm nổi bật">
        <article>
          <span>♨</span>
          <div>
            <b>Thông tin sản phẩm</b>
            <small>Hiển thị từ dữ liệu cửa hàng</small>
          </div>
        </article>
        <article>
          <span>✿</span>
          <div>
            <b>Danh mục rõ ràng</b>
            <small>Bánh mì và các món đi kèm</small>
          </div>
        </article>
        <article>
          <span>⌂</span>
          <div>
            <b>Thanh toán COD</b>
            <small>Thanh toán khi nhận hàng</small>
          </div>
        </article>
      </section>

      <section className="store-catalog store-menu-section" id="products">
        <div className="store-menu-heading">
          <div>
            <span className="store-kicker">MÓN NGON MỖI NGÀY</span>
            <h2>
              Danh mục <em>sản phẩm</em>
            </h2>
            <p>Chọn danh mục để xem các sản phẩm hiện có.</p>
          </div>
          <div className="store-menu-tabs" aria-label="Lọc theo danh mục">
            {tabs.map((item) => (
              <button
                className={category === item.id ? "active" : ""}
                key={item.id ?? "all"}
                aria-pressed={category === item.id}
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
        {checkoutAttempt && (
          <p className="store-message store-warning" role="status">
            Có một đơn hàng chưa xác nhận được kết quả. Giỏ hàng đang tạm khóa để tránh tạo đơn
            trùng.{" "}
            <button
              className="store-inline-action"
              type="button"
              onClick={() => setShowCheckout(true)}
            >
              Xử lý đơn chưa rõ
            </button>
          </p>
        )}
        {checkoutState.status === "owner-mismatch" && (
          <p className="store-message store-warning" role="status">
            Có một đơn hàng chưa rõ kết quả thuộc tài khoản khác trên trình duyệt này. Nội dung được
            ẩn để bảo vệ riêng tư và giỏ hàng đang tạm khóa.{" "}
            <button
              className="store-inline-action"
              type="button"
              onClick={() => setShowCheckout(true)}
            >
              Xử lý đơn chưa rõ
            </button>
          </p>
        )}
        {checkoutState.status === "invalid" && (
          <p className="store-message store-warning" role="status">
            Bản ghi đơn hàng chưa rõ trên trình duyệt bị hỏng. Giỏ hàng đang tạm khóa cho đến khi
            bạn chủ động xóa bản ghi đó.{" "}
            <button
              className="store-inline-action"
              type="button"
              onClick={() => setShowCheckout(true)}
            >
              Xử lý
            </button>
          </p>
        )}
        {checkoutState.status === "unavailable" && (
          <p className="store-message store-error" role="alert">
            Không thể đọc bộ nhớ cục bộ an toàn nên hệ thống không thể xác minh đơn hàng trước khi
            đặt.
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
                      src={product.imageUrl || foodPlaceholder}
                      alt={
                        product.imageUrl
                          ? product.name
                          : `Ảnh minh họa thay thế cho ${product.name}`
                      }
                      width={640}
                      height={640}
                      unoptimized
                      onError={(event) => {
                        const image = event.currentTarget;
                        const fallback = imageFallback(
                          image.src.split("?")[0].split("#")[0].replace(window.location.origin, ""),
                        );
                        if (fallback) {
                          image.dataset.fallbackUsed = "true";
                          image.src = fallback;
                          image.alt = `Ảnh minh họa thay thế cho ${product.name}`;
                        }
                      }}
                    />
                    <span className="store-image-illustrative-label">
                      {product.imageUrl
                        ? "ẢNH SẢN PHẨM · THAY BẰNG ẢNH MINH HỌA NẾU LỖI"
                        : "ẢNH MINH HỌA"}
                    </span>
                    <span className="store-product-tag">
                      {product.categories?.[0]
                        ? (matchingFoodGroup(product.categories[0])?.name ??
                          product.categories[0].name)
                        : "SẢN PHẨM"}
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
                          disabled={checkoutBlocked}
                          onClick={() => changeQuantity(product, -1)}
                        >
                          −
                        </button>
                        <span>{quantities[product.id]}</span>
                        <button
                          aria-label={`Thêm ${product.name}`}
                          disabled={checkoutBlocked}
                          onClick={() => changeQuantity(product, 1)}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        className="store-add-button"
                        disabled={
                          product.stock < 1 || !cartReady || cartUnavailable || checkoutBlocked
                        }
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
          <span className="store-kicker">TUẤN KHANG</span>
          <h2>
            Danh mục sản phẩm,
            <br />
            <em>thông tin rõ ràng.</em>
          </h2>
          <p>Danh sách sản phẩm, giá và tình trạng hàng được lấy từ dữ liệu cửa hàng hiện có.</p>
          <a href="#products">
            Xem thực đơn <span>↗</span>
          </a>
        </div>
        <div className="store-story-image">
          <Image
            src="/food-placeholder.svg"
            alt="Ảnh minh họa thay thế — cần thay bằng ảnh sản phẩm được cấp quyền"
            width={900}
            height={700}
            unoptimized
          />
          <span>
            ẢNH
            <br />
            MINH HỌA
          </span>
        </div>
      </section>

      <section className="store-order-banner">
        <div>
          <span className="store-kicker">TUẤN KHANG</span>
          <h2>Chọn sản phẩm trong danh mục cửa hàng.</h2>
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
            <span className="store-kicker">THANH TOÁN KHI NHẬN HÀNG</span>
            <h2 id="checkout-heading">Thông tin giao hàng · COD</h2>
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
            {!token ? (
              <p>
                Vui lòng <Link href="/login">đăng nhập tài khoản khách hàng</Link> để đặt hàng.
              </p>
            ) : checkoutState.status === "owner-mismatch" ? (
              <div className="store-checkout-uncertain">
                <p className="store-message store-warning" role="alert">
                  Trình duyệt này đang giữ một đơn chưa rõ kết quả thuộc một tài khoản khác. Vì lý
                  do riêng tư, nội dung đơn không được hiển thị. Hệ thống không cho đặt đơn mới cho
                  đến khi bạn chủ động hủy bỏ bản ghi đó.
                </p>
                {abandonControls(
                  <>
                    Đơn chưa rõ kết quả thuộc tài khoản khác có thể đã được tạo thành công. Nếu hủy
                    bỏ, bản ghi trên trình duyệt này sẽ bị xóa và bạn có thể đặt đơn mới. Hãy kiểm
                    tra mục{" "}
                    <Link href="/orders" onClick={() => setShowCheckout(false)}>
                      Đơn hàng của tôi
                    </Link>{" "}
                    của tài khoản liên quan trước khi tiếp tục.
                  </>,
                )}
              </div>
            ) : checkoutState.status === "invalid" ? (
              <div className="store-checkout-uncertain">
                <p className="store-message store-warning" role="alert">
                  Bản ghi đơn chưa rõ kết quả trên trình duyệt bị hỏng và không thể xác minh nội
                  dung. Hệ thống không cho đặt đơn mới cho đến khi bạn chủ động xóa bản ghi đó.
                </p>
                {abandonControls(
                  <>
                    Bản ghi bị hỏng có thể chứa thông tin của một đơn đã gửi trước đó. Nếu xóa bỏ,
                    bạn có thể đặt đơn mới nhưng hãy kiểm tra mục{" "}
                    <Link href="/orders" onClick={() => setShowCheckout(false)}>
                      Đơn hàng của tôi
                    </Link>{" "}
                    trước để tránh trùng đơn.
                  </>,
                )}
              </div>
            ) : checkoutState.status === "unavailable" ? (
              <p className="store-message store-error" role="alert">
                Không thể truy cập bộ nhớ cục bộ an toàn nên hệ thống không thể giữ mã chống trùng.
                Đơn hàng chưa được gửi. Hãy kiểm tra quyền lưu trữ của trình duyệt rồi tải lại
                trang.
              </p>
            ) : checkoutAttempt ? (
              <div className="store-checkout-uncertain">
                <p className="store-message store-warning" role="alert">
                  Đơn hàng trước chưa xác nhận được kết quả. Hệ thống đã giữ nguyên nội dung và mã
                  chống trùng; không thể đặt giỏ hiện tại cho đến khi bạn thử lại đơn cũ hoặc chủ
                  động hủy bỏ.
                </p>
                <div className="store-checkout-attempt">
                  <p>
                    <span>Người nhận</span>
                    <strong>{checkoutAttempt.payload.recipientName}</strong>
                  </p>
                  <p>
                    <span>Số điện thoại</span>
                    <strong>{checkoutAttempt.payload.phone}</strong>
                  </p>
                  <p>
                    <span>Địa chỉ</span>
                    <strong>{checkoutAttempt.payload.shippingAddress}</strong>
                  </p>
                  {checkoutAttempt.payload.items.map((item) => {
                    const product = products.find((candidate) => candidate.id === item.productId);
                    return (
                      <p key={item.productId}>
                        <span>{product?.name ?? `Sản phẩm #${item.productId}`}</span>
                        <strong>× {item.quantity}</strong>
                      </p>
                    );
                  })}
                </div>
                {attemptCartChanged && (
                  <p className="store-message store-error" role="status">
                    Giỏ hàng hiện tại đã khác đơn chưa rõ kết quả. Bạn vẫn có thể thử lại đúng đơn
                    cũ, nhưng phải hủy bỏ đơn đó trước khi đặt giỏ hiện tại.
                  </p>
                )}
                <div className="store-checkout-actions">
                  <button
                    className="store-submit-order"
                    type="button"
                    disabled={submittingOrder}
                    onClick={retryCheckoutAttempt}
                  >
                    {submittingOrder ? "Đang gửi lại…" : "Thử lại đúng đơn cũ"}
                  </button>
                  {abandonControls(
                    <>
                      Đơn hàng cũ có thể đã được tạo thành công. Nếu hủy bỏ, hệ thống sẽ cho phép
                      đặt giỏ hiện tại bằng một mã mới và có thể tạo đơn trùng. Hãy kiểm tra mục{" "}
                      <Link href="/orders" onClick={() => setShowCheckout(false)}>
                        Đơn hàng của tôi
                      </Link>{" "}
                      trước khi tiếp tục.
                    </>,
                  )}
                </div>
              </div>
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
                <p className="store-checkout-cod">
                  Phương thức thanh toán: tiền mặt khi nhận hàng (COD).
                </p>
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
                  <button
                    className="store-submit-order"
                    type="submit"
                    disabled={cart.length === 0 || submittingOrder}
                  >
                    {submittingOrder ? "Đang gửi đơn…" : "Xác nhận đặt hàng"}
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

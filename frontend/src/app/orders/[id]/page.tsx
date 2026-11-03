"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClientMenu } from "@/components/ClientMenu";
import { SharedFooter, SharedHeader } from "@/components/SharedChrome";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, storeApi, type Order } from "@/lib/store";
import "../../store.css";

const money = (amount: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

const statusLabels: Record<string, string> = {
  pending: "Chờ xác nhận",
  processing: "Đang xử lý",
  paid: "Đã thanh toán",
  shipped: "Đang giao",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

export default function CustomerOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const orderId = Number(rawId);
  const validId = Number.isInteger(orderId) && orderId > 0;
  const { token, ready } = useAuth({ storageKey: "store-token" });
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [notFound, setNotFound] = useState(!validId);
  const requestId = useRef(0);

  const loadOrder = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    if (!validId) {
      setLoading(false);
      setNotFound(true);
      setError("Mã đơn hàng không hợp lệ.");
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setNotFound(false);
    setError("");
    try {
      const result = await storeApi.customerOrder(token, orderId);
      if (currentRequest !== requestId.current) return;
      setOrder(result);
    } catch (reason) {
      if (currentRequest !== requestId.current) return;
      // Keep a previously loaded order visible if only a refresh failed.
      setNotFound(reason instanceof ApiError && reason.status === 404);
      setError(reason instanceof Error ? reason.message : "Không tải được chi tiết đơn hàng.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [orderId, token, validId]);

  useEffect(() => {
    if (ready && !token) router.replace("/login");
  }, [ready, router, token]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) void loadOrder();
    });
    return () => {
      canceled = true;
      requestId.current += 1;
    };
  }, [loadOrder]);

  async function cancelOrder() {
    if (!token || !order || order.status !== "pending" || canceling) return;
    if (
      !window.confirm(`Hủy đơn hàng ${order.orderNumber}? Số lượng sản phẩm sẽ được trả lại kho.`)
    ) {
      return;
    }
    setCanceling(true);
    setError("");
    setNotice("");
    try {
      const updated = await storeApi.cancelOrder(token, order.id);
      setOrder(updated);
      setNotice("Đơn hàng đã được hủy.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể hủy đơn hàng.");
    } finally {
      setCanceling(false);
    }
  }

  return (
    <main className="store-page store-orders-page">
      <SharedHeader className="store-header">
        <ClientMenu />
      </SharedHeader>
      <section className="store-orders-content">
        <div className="store-order-detail-heading">
          <div>
            <span className="store-kicker">CHI TIẾT ĐƠN HÀNG</span>
            <h1>{order?.orderNumber ?? "Đơn hàng"}</h1>
          </div>
          <Link className="store-order-back" href="/orders">
            ← Danh sách đơn hàng
          </Link>
        </div>

        {notice && (
          <p className="store-message store-success" role="status">
            {notice}
          </p>
        )}
        {error && !notFound && (
          <div className="store-message store-error" role="alert">
            <p>{error}</p>
            {validId && token && (
              <button
                className="store-inline-action"
                type="button"
                onClick={() => void loadOrder()}
              >
                Thử lại
              </button>
            )}
          </div>
        )}

        {!ready || (loading && !order) ? (
          <p className="store-empty" role="status">
            Đang tải chi tiết đơn hàng…
          </p>
        ) : !token ? (
          <p className="store-empty" role="status">
            Đang chuyển đến trang đăng nhập…
          </p>
        ) : notFound ? (
          <div className="store-empty store-orders-empty">
            <p>Không tìm thấy đơn hàng.</p>
            <Link className="store-hero-button" href="/orders">
              Về danh sách đơn hàng
            </Link>
          </div>
        ) : order ? (
          <article className="store-order-detail" aria-busy={loading}>
            <header>
              <span className={`store-order-status ${order.status}`}>
                {statusLabels[order.status] ?? order.status}
              </span>
              <button
                className="store-inline-action"
                type="button"
                disabled={loading}
                onClick={() => void loadOrder()}
              >
                {loading ? "Đang làm mới…" : "↻ Làm mới"}
              </button>
            </header>
            <dl className="store-order-detail-grid">
              <div>
                <dt>Người nhận</dt>
                <dd>{order.recipientName}</dd>
              </div>
              <div>
                <dt>Điện thoại</dt>
                <dd>{order.phone}</dd>
              </div>
              <div>
                <dt>Địa chỉ giao hàng</dt>
                <dd>{order.shippingAddress}</dd>
              </div>
              <div>
                <dt>Ngày đặt</dt>
                <dd>{formatDate(order.createdAt)}</dd>
              </div>
              <div>
                <dt>Thanh toán</dt>
                <dd>
                  {(order.paymentMethod ?? "cod") === "cod"
                    ? "COD khi nhận hàng"
                    : order.paymentMethod}
                </dd>
              </div>
            </dl>
            <div className="store-order-detail-items">
              {order.items.map((item) => (
                <p key={`${order.id}-${item.productId}`}>
                  <span>
                    {item.productName} × {item.quantity}
                  </span>
                  <strong>{money(item.unitPriceVnd * item.quantity)}</strong>
                </p>
              ))}
              <p className="store-order-detail-total">
                <span>Tổng cộng</span>
                <strong>{money(order.totalVnd)}</strong>
              </p>
            </div>
            {order.status === "pending" && (
              <div className="store-order-detail-actions">
                <button
                  className="store-danger-button"
                  type="button"
                  disabled={canceling}
                  onClick={() => void cancelOrder()}
                >
                  {canceling ? "Đang hủy…" : "Hủy đơn hàng"}
                </button>
              </div>
            )}
          </article>
        ) : null}
      </section>
      <SharedFooter className="store-footer store-home-footer">
        <Link className="store-brand" href="/">
          Tuấn Khang
        </Link>
        <span>Thêm món ngon, ấm vị bữa cơm nhà.</span>
        <Link href="/#products">Tiếp tục mua sắm</Link>
      </SharedFooter>
    </main>
  );
}

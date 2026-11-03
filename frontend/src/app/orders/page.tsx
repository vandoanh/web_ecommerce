"use client";

import Link from "next/link";
import { SharedFooter, SharedHeader } from "@/components/SharedChrome";
import { ClientMenu } from "@/components/ClientMenu";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Order } from "@/lib/store";
import "../store.css";

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

const pageSize = 20;

export default function CustomerOrdersPage() {
  const router = useRouter();
  const { token, ready } = useAuth({ storageKey: "store-token" });
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await storeApi.customerOrders(token, { page, pageSize });
      setOrders(result.items);
      setTotal(result.total);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được đơn hàng.");
    } finally {
      setLoading(false);
    }
  }, [page, token]);

  useEffect(() => {
    if (ready && !token) router.replace("/login");
  }, [ready, router, token]);
  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) void loadOrders();
    });
    return () => {
      canceled = true;
    };
  }, [loadOrders]);

  async function cancelOrder(order: Order) {
    if (!token) return;
    if (
      !window.confirm(
        `Hủy đơn ${order.orderNumber}? Tồn kho sẽ được hoàn lại và thao tác này không thể hoàn tác.`,
      )
    ) {
      return;
    }
    setCancellingId(order.id);
    setError("");
    setNotice("");
    try {
      const updated = await storeApi.customerCancelOrder(token, order.id);
      setOrders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`Đã hủy đơn ${updated.orderNumber}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể hủy đơn hàng.");
    } finally {
      setCancellingId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="store-page store-orders-page">
      <SharedHeader className="store-header">
        <ClientMenu />
      </SharedHeader>
      <section className="store-orders-content">
        <span className="store-kicker">TÀI KHOẢN KHÁCH HÀNG</span>
        <h1>Đơn hàng của tôi</h1>
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
        {!ready || !token ? (
          <p className="store-empty">Đang kiểm tra đăng nhập…</p>
        ) : loading && orders.length === 0 ? (
          <p className="store-empty">Đang tải đơn hàng…</p>
        ) : orders.length === 0 ? (
          <div className="store-empty store-orders-empty">
            <p>Bạn chưa có đơn hàng nào.</p>
            <Link className="store-hero-button" href="/#products">
              Khám phá sản phẩm <span>→</span>
            </Link>
          </div>
        ) : (
          <>
            <div className="store-order-list">
              {orders.map((order) => (
                <article className="store-order-card" key={order.id}>
                  <header>
                    <div>
                      <small>MÃ ĐƠN HÀNG</small>
                      <strong>{order.orderNumber}</strong>
                    </div>
                    <span className={`store-order-status ${order.status}`}>
                      {statusLabels[order.status] ?? order.status}
                    </span>
                  </header>
                  <div className="store-order-items">
                    {order.items.map((item) => (
                      <p key={`${order.id}-${item.productId}`}>
                        <span>
                          {item.productName} × {item.quantity}
                        </span>
                        <strong>{money(item.unitPriceVnd * item.quantity)}</strong>
                      </p>
                    ))}
                  </div>
                  <footer>
                    <span>Đặt ngày {new Date(order.createdAt).toLocaleDateString("vi-VN")}</span>
                    <div className="store-order-footer-actions">
                      {order.status === "pending" && (
                        <button
                          className="store-order-cancel"
                          type="button"
                          disabled={cancellingId === order.id}
                          onClick={() => void cancelOrder(order)}
                        >
                          {cancellingId === order.id ? "Đang hủy…" : "Hủy đơn"}
                        </button>
                      )}
                      <strong>{money(order.totalVnd)}</strong>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
            {total > pageSize && (
              <div className="store-orders-pagination">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  ← Trang trước
                </button>
                <span>
                  Trang {page} / {pageCount}
                </span>
                <button
                  type="button"
                  disabled={page >= pageCount || loading}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                >
                  Trang sau →
                </button>
              </div>
            )}
          </>
        )}
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

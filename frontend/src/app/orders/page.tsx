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

export default function CustomerOrdersPage() {
  const router = useRouter();
  const { token, ready } = useAuth({ storageKey: "store-token" });
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const loadOrders = useCallback(async () => {
    if (!token) return;
    try {
      const result = await storeApi.customerOrders(token);
      setOrders(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được đơn hàng.");
    }
  }, [token]);

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
        {!ready || !token ? (
          <p className="store-empty">Đang kiểm tra đăng nhập…</p>
        ) : orders.length === 0 ? (
          <div className="store-empty store-orders-empty">
            <p>Bạn chưa có đơn hàng nào.</p>
            <Link className="store-hero-button" href="/#products">
              Khám phá sản phẩm <span>→</span>
            </Link>
          </div>
        ) : (
          <div className="store-order-list">
            {orders.map((order) => (
              <article className="store-order-card" key={order.id}>
                <header>
                  <div>
                    <small>MÃ ĐƠN HÀNG</small>
                    <strong>{order.orderNumber}</strong>
                  </div>
                  <span className={`store-order-status ${order.status}`}>
                    {order.status === "pending" ? "Chờ xác nhận" : order.status}
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
                  <strong>{money(order.totalVnd)}</strong>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
      <SharedFooter className="store-footer store-home-footer">
        <Link className="store-brand" href="/">Tuấn Khang</Link>
        <span>Thêm món ngon, ấm vị bữa cơm nhà.</span>
        <Link href="/#products">Tiếp tục mua sắm</Link>
      </SharedFooter>
    </main>
  );
}

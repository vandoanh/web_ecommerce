"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  storeApi,
  type DashboardStats,
  type Order,
  type Product,
} from "@/lib/store";
import "./admin.css";

const money = (amount: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

export default function AdminDashboard() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [dashboard, orderList, productList] = await Promise.all([
        storeApi.dashboard(token),
        storeApi.adminOrders(token),
        storeApi.adminProducts(token),
      ]);
      setStats(dashboard);
      setOrders(orderList.items);
      setProducts(productList.items);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tải dữ liệu quản trị.");
      if (reason instanceof Error && reason.message.includes("401")) router.replace("/admin/login");
    }
  }, [router, token]);

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) void refresh();
    });
    return () => {
      canceled = true;
    };
  }, [refresh]);

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="overview"
      title="Tổng quan"
      description="Hoạt động và hiệu suất cửa hàng của bạn."
      toolbar={<button onClick={() => void refresh()}>↻ Làm mới</button>}
    >
          {error && (
            <p className="admin-alert" role="alert">
              {error}
            </p>
          )}
          <section className="admin-stats" aria-label="Chỉ số cửa hàng">
            <article className="admin-stat primary">
              <span>Sản phẩm đang bán</span>
              <strong>{stats?.productCount ?? "—"}</strong>
              <i>▣</i>
              <small>Danh mục sản phẩm</small>
            </article>
            <article className="admin-stat success">
              <span>Tổng đơn hàng</span>
              <strong>{stats?.orderCount ?? "—"}</strong>
              <i>▤</i>
              <small>Tất cả trạng thái</small>
            </article>
            <article className="admin-stat warning">
              <span>Chờ xử lý</span>
              <strong>{stats?.pendingOrders ?? "—"}</strong>
              <i>◷</i>
              <small>Đơn cần xác nhận</small>
            </article>
            <article className="admin-stat danger">
              <span>Doanh thu</span>
              <strong>{stats ? money(stats.revenueVnd) : "—"}</strong>
              <i>₫</i>
              <small>Đơn chưa bị hủy</small>
            </article>
          </section>

          <section className="admin-panels admin-dashboard-panels">
            <article className="admin-panel" id="orders">
              <header>
                <div>
                  <h2>Đơn hàng gần đây</h2>
                  <p>Đơn mới nhất từ khách hàng</p>
                </div>
                <Link href="/admin/orders">Tất cả đơn hàng</Link>
              </header>
              <div className="admin-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>MÃ ĐƠN</th>
                      <th>KHÁCH HÀNG</th>
                      <th>SẢN PHẨM</th>
                      <th>TỔNG TIỀN</th>
                      <th>TRẠNG THÁI</th>
                      <th>NGÀY ĐẶT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 8).map((order) => (
                      <tr key={order.id}>
                        <td>
                          <strong>{order.orderNumber}</strong>
                        </td>
                        <td>{order.customerName || order.recipientName}</td>
                        <td>
                          {order.items
                            .map((item) => `${item.productName} × ${item.quantity}`)
                            .join(", ")}
                        </td>
                        <td>{money(order.totalVnd)}</td>
                        <td>
                          <span className={`admin-order-status ${order.status}`}>
                            {order.status === "pending" ? "Chờ xử lý" : order.status}
                          </span>
                        </td>
                        <td>{new Date(order.createdAt).toLocaleDateString("vi-VN")}</td>
                      </tr>
                    ))}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={6} className="admin-empty">
                          Chưa có đơn hàng.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <article className="admin-panel admin-products-panel">
            <header>
              <div>
                <h2>Sản phẩm trong cửa hàng</h2>
                <p>{products.length} mặt hàng</p>
              </div>
              <Link href="/admin/products">Xem tất cả ↗</Link>
            </header>
            <div className="admin-product-list">
              {products.slice(0, 6).map((product) => (
                <div className="admin-product-row" key={product.id}>
                  <Image
                    src={product.imageUrl || "https://placehold.co/80x80?text=MM"}
                    alt=""
                    width={80}
                    height={80}
                    unoptimized
                  />
                  <div>
                    <strong>{product.name}</strong>
                    <small>{product.sku}</small>
                    {product.categories?.length > 0 && (
                      <small>
                        {product.categories.map((category) => category.name).join(" · ")}
                      </small>
                    )}
                  </div>
                  <b>{money(product.priceVnd)}</b>
                  <span>{product.stock} còn trong kho</span>
                </div>
              ))}
              {products.length === 0 && <p className="admin-empty">Chưa có sản phẩm.</p>}
            </div>
          </article>
    </AdminShell>
  );
}

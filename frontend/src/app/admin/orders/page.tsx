"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Order } from "@/lib/store";

const money = (amount: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

const statusLabels: Record<string, string> = {
  pending: "Chờ xử lý",
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

export default function AdminOrdersPage() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const result = await storeApi.adminOrders(token);
      setOrders(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được danh sách đơn hàng.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  useEffect(() => {
    if (token) void refresh();
  }, [refresh, token]);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return orders.filter((order) => {
      if (status !== "all" && order.status !== status) return false;
      if (!query) return true;
      const searchable = [
        order.orderNumber,
        order.customerName,
        order.recipientName,
        order.phone,
        order.shippingAddress,
        ...order.items.map((item) => item.productName),
      ]
        .join(" ")
        .toLocaleLowerCase("vi");
      return searchable.includes(query);
    });
  }, [orders, search, status]);

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="orders"
      title="Quản lý đơn hàng"
      description="Theo dõi đơn hàng, thông tin giao nhận và sản phẩm khách đã đặt."
      toolbar={<button className="admin-toolbar-button" type="button" onClick={() => void refresh()}>↻ Làm mới</button>}
    >
      {error && <p className="admin-alert" role="alert">{error}</p>}
      <article className="admin-panel admin-orders-panel">
        <header>
          <div>
            <h2>Tất cả đơn hàng</h2>
            <p>{filteredOrders.length} / {orders.length} đơn hàng</p>
          </div>
        </header>
        <div className="admin-order-filters">
          <label>
            Tìm đơn hàng
            <input
              type="search"
              placeholder="Mã đơn, khách hàng, số điện thoại…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Trạng thái
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
              {orders.some((order) => !statusLabels[order.status]) && (
                <option value={orders.find((order) => !statusLabels[order.status])?.status}>
                  {orders.find((order) => !statusLabels[order.status])?.status}
                </option>
              )}
            </select>
          </label>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-orders-table">
            <thead>
              <tr>
                <th>MÃ ĐƠN</th>
                <th>KHÁCH HÀNG</th>
                <th>SẢN PHẨM</th>
                <th>TỔNG TIỀN</th>
                <th>TRẠNG THÁI</th>
                <th>NGÀY ĐẶT</th>
                <th>CHI TIẾT</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td><strong>{order.orderNumber}</strong></td>
                  <td>
                    <b>{order.customerName || order.recipientName}</b>
                    <small className="admin-order-secondary">{order.phone}</small>
                  </td>
                  <td className="admin-order-products">
                    {order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ")}
                  </td>
                  <td>{money(order.totalVnd)}</td>
                  <td>
                    <span className={`admin-order-status ${order.status}`}>
                      {statusLabels[order.status] ?? order.status}
                    </span>
                  </td>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>
                    <details className="admin-order-details">
                      <summary>Xem</summary>
                      <div>
                        <b>Người nhận:</b> {order.recipientName}<br />
                        <b>Điện thoại:</b> {order.phone}<br />
                        <b>Địa chỉ:</b> {order.shippingAddress}<br />
                        <b>Sản phẩm:</b>
                        <ul>
                          {order.items.map((item) => (
                            <li key={`${order.id}-${item.productId}`}>
                              {item.productName} × {item.quantity} — {money(item.unitPriceVnd)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
              {!loading && filteredOrders.length === 0 && (
                <tr><td colSpan={7} className="admin-empty">{orders.length ? "Không tìm thấy đơn hàng phù hợp." : "Chưa có đơn hàng."}</td></tr>
              )}
              {loading && (
                <tr><td colSpan={7} className="admin-empty">Đang tải đơn hàng…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </AdminShell>
  );
}

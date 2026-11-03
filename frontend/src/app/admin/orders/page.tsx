"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

type StatusAction = { label: string; status: string; danger?: boolean };

function orderActions(status: string): StatusAction[] {
  switch (status) {
    case "pending":
      return [
        { label: "Xử lý", status: "processing" },
        { label: "Hủy", status: "cancelled", danger: true },
      ];
    case "processing":
      return [
        { label: "Giao hàng", status: "shipped" },
        { label: "Hủy", status: "cancelled", danger: true },
      ];
    case "shipped":
      return [{ label: "Hoàn tất", status: "completed" }];
    default:
      return [];
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

const pageSize = 20;

export default function AdminOrdersPage() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const {
    data,
    error,
    isLoading: loading,
    refetch: refresh,
  } = useQuery({
    queryKey: ["admin", "orders", token, page, status, debouncedSearch],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) throw new Error("Cần đăng nhập để tải đơn hàng.");
      return storeApi.adminOrders(token, {
        page,
        pageSize,
        status: status === "all" ? "" : status,
        q: debouncedSearch,
      });
    },
  });

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  const orders = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  async function updateStatus(order: Order, nextStatus: string) {
    if (!token) return;
    if (
      nextStatus === "cancelled" &&
      !window.confirm(
        `Hủy đơn ${order.orderNumber}? Tồn kho sẽ được hoàn lại và thao tác này không thể hoàn tác.`,
      )
    ) {
      return;
    }
    setBusyOrderId(order.id);
    setActionError("");
    setNotice("");
    try {
      await storeApi.adminUpdateOrderStatus(token, order.id, nextStatus);
      setNotice(
        `Đã cập nhật đơn ${order.orderNumber} sang “${statusLabels[nextStatus] ?? nextStatus}”.`,
      );
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Không thể cập nhật đơn hàng.");
    } finally {
      setBusyOrderId(null);
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="orders"
      title="Quản lý đơn hàng"
      description="Theo dõi đơn hàng, thông tin giao nhận và sản phẩm khách đã đặt."
      toolbar={
        <button className="admin-toolbar-button" type="button" onClick={() => void refresh()}>
          ↻ Làm mới
        </button>
      }
    >
      {error && (
        <p className="admin-alert" role="alert">
          {error instanceof Error ? error.message : "Không tải được danh sách đơn hàng."}
        </p>
      )}
      {actionError && (
        <p className="admin-alert" role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <p className="admin-success" role="status">
          {notice}
        </p>
      )}
      <article className="admin-panel admin-orders-panel">
        <header>
          <div>
            <h2>Tất cả đơn hàng</h2>
            <p>
              {orders.length} / {total} đơn hàng · Trang {page} / {pageCount}
            </p>
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
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
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
                <th>THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.orderNumber}</strong>
                  </td>
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
                        <b>Người nhận:</b> {order.recipientName}
                        <br />
                        <b>Điện thoại:</b> {order.phone}
                        <br />
                        <b>Địa chỉ:</b> {order.shippingAddress}
                        <br />
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
                  <td>
                    <div className="admin-order-actions">
                      {orderActions(order.status).map((action) => (
                        <button
                          key={action.status}
                          className={action.danger ? "danger" : ""}
                          type="button"
                          disabled={busyOrderId === order.id}
                          onClick={() => void updateStatus(order, action.status)}
                        >
                          {busyOrderId === order.id ? "Đang lưu…" : action.label}
                        </button>
                      ))}
                      {orderActions(order.status).length === 0 && (
                        <span className="admin-order-secondary">Không có thao tác</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="admin-empty">
                    {total ? "Không tìm thấy đơn hàng phù hợp." : "Chưa có đơn hàng."}
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={8} className="admin-empty">
                    Đang tải đơn hàng…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total > pageSize && (
          <div className="admin-order-pagination">
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
      </article>
    </AdminShell>
  );
}

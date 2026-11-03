"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, storeApi, type Order } from "@/lib/store";

const money = (amount: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

const labels: Record<string, string> = {
  pending: "Chờ xử lý",
  processing: "Đang xử lý",
  paid: "Đã thanh toán",
  shipped: "Đang giao",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
};

function nextActions(status: string) {
  if (status === "pending") return ["processing", "cancelled"];
  if (status === "processing") return ["shipped", "cancelled"];
  if (status === "shipped") return ["completed"];
  return [];
}

export default function AdminOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(rawId);
  const validId = Number.isInteger(id) && id > 0;
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notFound, setNotFound] = useState(!validId);

  const loadOrder = useCallback(async () => {
    if (!token) return;
    if (!validId) {
      setNotFound(true);
      setError("Mã đơn hàng không hợp lệ.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setOrder(await storeApi.adminOrder(token, id));
      setNotFound(false);
    } catch (reason) {
      setNotFound(reason instanceof ApiError && reason.status === 404);
      setError(reason instanceof Error ? reason.message : "Không tải được đơn hàng.");
    } finally {
      setLoading(false);
    }
  }, [id, token, validId]);

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadOrder();
    });
    return () => {
      active = false;
    };
  }, [loadOrder]);

  async function updateStatus(status: string) {
    if (!token || !order || saving) return;
    if (
      status === "cancelled" &&
      !window.confirm(`Hủy đơn ${order.orderNumber}? Tồn kho sẽ được hoàn lại.`)
    ) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      setOrder(await storeApi.updateOrderStatus(token, order.id, status));
      setNotice(`Đã cập nhật trạng thái: ${labels[status] ?? status}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể cập nhật đơn hàng.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      active="orders"
      title="Chi tiết đơn hàng"
      description="Thông tin giao nhận, sản phẩm và cập nhật trạng thái đơn hàng."
      toolbar={
        <Link className="admin-toolbar-button" href="/admin/orders">
          ← Danh sách đơn hàng
        </Link>
      }
    >
      {notice && (
        <p className="admin-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="admin-alert" role="alert">
          <p>{error}</p>
          {!notFound && (
            <button className="admin-inline-action" onClick={() => void loadOrder()}>
              Thử lại
            </button>
          )}
        </div>
      )}
      {loading ? (
        <p className="admin-loading-note" role="status">
          Đang tải đơn hàng…
        </p>
      ) : notFound ? (
        <section className="admin-panel">
          <p>Không tìm thấy đơn hàng.</p>
        </section>
      ) : order ? (
        <article className="admin-panel admin-order-view" aria-busy={saving}>
          <header className="admin-order-view-header">
            <div>
              <span className="admin-order-secondary">MÃ ĐƠN HÀNG</span>
              <h2>{order.orderNumber}</h2>
            </div>
            <span className={`admin-order-status ${order.status}`}>
              {labels[order.status] ?? order.status}
            </span>
          </header>
          <dl className="admin-order-view-grid">
            <div>
              <dt>Khách hàng</dt>
              <dd>{order.customerName || order.recipientName}</dd>
            </div>
            <div>
              <dt>Người nhận</dt>
              <dd>{order.recipientName}</dd>
            </div>
            <div>
              <dt>Số điện thoại</dt>
              <dd>{order.phone}</dd>
            </div>
            <div>
              <dt>Địa chỉ giao hàng</dt>
              <dd>{order.shippingAddress}</dd>
            </div>
            <div>
              <dt>Ngày đặt</dt>
              <dd>{new Date(order.createdAt).toLocaleString("vi-VN")}</dd>
            </div>
            <div>
              <dt>Thanh toán</dt>
              <dd>{order.paymentMethod === "cod" ? "COD" : order.paymentMethod || "COD"}</dd>
            </div>
          </dl>
          <div className="admin-order-view-items">
            <h3>Sản phẩm</h3>
            <div className="admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th>Đơn giá</th>
                    <th>Số lượng</th>
                    <th>Tạm tính</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={`${order.id}-${item.productId}`}>
                      <td>{item.productName}</td>
                      <td>{money(item.unitPriceVnd)}</td>
                      <td>{item.quantity}</td>
                      <td>{money(item.unitPriceVnd * item.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={3}>Tổng cộng</th>
                    <th>{money(order.totalVnd)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {nextActions(order.status).length > 0 && (
            <div className="admin-order-view-actions">
              <strong>Cập nhật trạng thái</strong>
              {nextActions(order.status).map((status) => (
                <button
                  key={status}
                  className={status === "cancelled" ? "danger" : ""}
                  type="button"
                  disabled={saving}
                  onClick={() => void updateStatus(status)}
                >
                  {status === "processing"
                    ? "Bắt đầu xử lý"
                    : status === "shipped"
                      ? "Đánh dấu đang giao"
                      : status === "completed"
                        ? "Hoàn tất"
                        : "Hủy đơn"}
                </button>
              ))}
            </div>
          )}
          {saving && (
            <p className="admin-loading-note" role="status">
              Đang lưu thay đổi…
            </p>
          )}
        </article>
      ) : null}
    </AdminShell>
  );
}

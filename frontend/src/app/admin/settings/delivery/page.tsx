"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, storeApi, type DeliverySettings } from "@/lib/store";

type DeliveryForm = {
  phone: string;
  address: string;
  mapLocation: string;
  deliveryText: string;
};

const emptyDeliveryForm: DeliveryForm = {
  phone: "",
  address: "",
  mapLocation: "",
  deliveryText: "",
};

function formFromSettings(settings: DeliverySettings): DeliveryForm {
  return {
    phone: settings.phone,
    address: settings.address,
    mapLocation: settings.mapLocation,
    deliveryText: settings.deliveryText,
  };
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

export default function AdminDeliverySettingsPage() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [settings, setSettings] = useState<DeliverySettings | null>(null);
  const [form, setForm] = useState<DeliveryForm>(emptyDeliveryForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const result = await storeApi.adminDeliverySettings(token);
      setSettings(result);
      setForm(formFromSettings(result));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được cấu hình giao hàng.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) void load();
    });
    return () => {
      canceled = true;
    };
  }, [load]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !settings) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await storeApi.updateDeliverySettings(token, {
        ...form,
        expectedVersion: settings.version,
      });
      setSettings(updated);
      setForm(formFromSettings(updated));
      setNotice("Đã lưu cấu hình giao hàng.");
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "VERSION_CONFLICT") {
        setError(
          "Cấu hình giao hàng đã được cập nhật ở phiên khác. Vui lòng làm mới dữ liệu rồi thử lại.",
        );
      } else {
        setError(reason instanceof Error ? reason.message : "Không lưu được cấu hình giao hàng.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="delivery"
      title="Cấu hình giao hàng"
      description="Thông tin hiển thị cho khách hàng; không dùng để tính phí hoặc kiểm tra khu vực giao hàng."
      toolbar={
        <button
          className="admin-toolbar-button"
          type="button"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          ↻ Làm mới
        </button>
      }
    >
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-success" role="status">
          {notice}
        </p>
      )}
      <article className="admin-panel admin-product-editor admin-delivery-editor">
        <header>
          <div>
            <h2>Thông tin giao hàng</h2>
            <p>
              {settings
                ? `Cập nhật lần cuối ${formatUpdatedAt(settings.updatedAt)} · Phiên bản ${settings.version}`
                : "Thông tin hiển thị trên cửa hàng."}
            </p>
          </div>
        </header>
        {loading && !settings ? (
          <p>Đang tải cấu hình giao hàng…</p>
        ) : (
          <form className="admin-management-form" onSubmit={saveSettings}>
            <label>
              Số điện thoại
              <input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                maxLength={32}
              />
            </label>
            <label className="wide">
              Địa chỉ
              <textarea
                rows={3}
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
                maxLength={2000}
              />
            </label>
            <label className="wide">
              Vị trí Google Maps
              <input
                value={form.mapLocation}
                onChange={(event) => setForm({ ...form, mapLocation: event.target.value })}
                maxLength={2000}
              />
            </label>
            <label className="wide">
              Nội dung giao hàng
              <textarea
                rows={5}
                value={form.deliveryText}
                onChange={(event) => setForm({ ...form, deliveryText: event.target.value })}
                maxLength={5000}
              />
            </label>
            <div className="admin-form-actions">
              <button type="submit" disabled={busy || loading || !settings}>
                {busy ? "Đang lưu…" : "Lưu cấu hình"}
              </button>
            </div>
          </form>
        )}
      </article>
    </AdminShell>
  );
}

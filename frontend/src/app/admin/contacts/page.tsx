"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Contact } from "@/lib/store";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function mapsHref(value: string) {
  return /^https?:\/\//i.test(value)
    ? value
    : `https://www.google.com/maps?q=${encodeURIComponent(value)}`;
}

export default function AdminContactsPage() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const result = await storeApi.adminContacts(token);
      setContacts(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được danh sách liên hệ.");
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
      if (!canceled) void refresh();
    });
    return () => {
      canceled = true;
    };
  }, [refresh]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    if (!query) return contacts;
    return contacts.filter((contact) =>
      [contact.name, contact.phone, contact.address, contact.mapLocation]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(query),
    );
  }, [contacts, search]);

  async function remove(contact: Contact) {
    if (!token || !window.confirm(`Xóa liên hệ của "${contact.name}"?`)) return;
    setDeleting(contact.id);
    setError("");
    try {
      await storeApi.deleteContact(token, contact.id);
      setContacts((current) => current.filter((item) => item.id !== contact.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xóa được liên hệ.");
    } finally {
      setDeleting(null);
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="contacts"
      title="Quản lý liên hệ"
      description="Thông tin khách hàng gửi từ trang liên hệ, kèm vị trí Google Maps."
      toolbar={
        <button className="admin-toolbar-button" type="button" onClick={() => void refresh()}>
          ↻ Làm mới
        </button>
      }
    >
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      <article className="admin-panel admin-contacts-panel">
        <header>
          <div>
            <h2>Tất cả liên hệ</h2>
            <p>
              {filteredContacts.length} / {contacts.length} liên hệ
            </p>
          </div>
        </header>
        <div className="admin-order-filters admin-contacts-filters">
          <label>
            Tìm liên hệ
            <input
              type="search"
              placeholder="Họ tên, số điện thoại, địa chỉ…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-contacts-table">
            <thead>
              <tr>
                <th>KHÁCH HÀNG</th>
                <th>ĐIỆN THOẠI</th>
                <th>ĐỊA CHỈ</th>
                <th>VỊ TRÍ GOOGLE MAPS</th>
                <th>NGÀY GỬI</th>
                <th>HÀNH ĐỘNG</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <b>{contact.name}</b>
                    <small className="admin-order-secondary">#{contact.id}</small>
                  </td>
                  <td>
                    <a className="admin-contact-phone" href={`tel:${contact.phone}`}>
                      {contact.phone}
                    </a>
                  </td>
                  <td className="admin-contact-address">{contact.address}</td>
                  <td>
                    <a
                      className="admin-contact-map-link"
                      href={mapsHref(contact.mapLocation)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Mở Google Maps ↗
                    </a>
                  </td>
                  <td className="admin-contact-date">{formatDate(contact.createdAt)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        className="danger"
                        type="button"
                        disabled={deleting === contact.id}
                        onClick={() => void remove(contact)}
                      >
                        {deleting === contact.id ? "Đang xóa…" : "Xóa"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredContacts.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">
                    {contacts.length
                      ? "Không tìm thấy liên hệ phù hợp."
                      : "Chưa có liên hệ nào từ trang liên hệ."}
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={6} className="admin-empty">
                    Đang tải liên hệ…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </AdminShell>
  );
}

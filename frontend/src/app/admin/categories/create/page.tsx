"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { storeApi } from "@/lib/store";

type CategoryForm = { name: string; slug: string; description: string };
const emptyForm: CategoryForm = { name: "", slug: "", description: "" };
const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export default function CreateCategoryPage() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await storeApi.createCategory(token, {
        name: form.name.trim(),
        slug: slugify(form.slug),
        description: form.description.trim(),
      });
      setForm(emptyForm);
      setNotice("Đã tạo danh mục.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tạo được danh mục.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="categories"
      title="Thêm danh mục"
      description="Tạo nhóm mới để tổ chức sản phẩm trong cửa hàng."
    >
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}
      <article className="admin-panel admin-category-editor">
        <header>
          <div>
            <h2>Thông tin danh mục</h2>
            <p>Các trường có dấu * là bắt buộc.</p>
          </div>
          <Link href="/admin/categories">Quay lại danh sách</Link>
        </header>
        <form className="admin-management-form" onSubmit={createCategory}>
          <label>
            Tên danh mục *
            <input
              value={form.name}
              onChange={(event) => {
                const name = event.target.value;
                setForm((current) => ({ ...current, name, slug: slugify(name) }));
              }}
              required
              maxLength={120}
            />
          </label>
          <label>
            Slug *
            <input
              value={form.slug}
              onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
              required
              maxLength={140}
              pattern="[a-zA-Z0-9-]+"
            />
          </label>
          <label className="wide">
            Mô tả
            <textarea
              rows={4}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              maxLength={500}
            />
          </label>
          <div className="admin-form-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Đang lưu…" : "Tạo danh mục"}
            </button>
            <Link className="admin-cancel-link" href="/admin/categories">
              Hủy
            </Link>
          </div>
        </form>
      </article>
    </AdminShell>
  );
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Category } from "@/lib/store";

type CategoryForm = { name: string; slug: string; description: string };

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

export default function EditCategoryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [category, setCategory] = useState<Category | null>(null);
  const [form, setForm] = useState<CategoryForm>({ name: "", slug: "", description: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const categoryId = Number(id);
  const invalidCategoryId = !Number.isSafeInteger(categoryId) || categoryId < 1;

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  useEffect(() => {
    if (invalidCategoryId) return;

    let canceled = false;
    storeApi.categories()
      .then(({ items }) => {
        if (canceled) return;
        const found = items.find((item) => item.id === categoryId);
        if (!found) {
          setError("Không tìm thấy danh mục cần sửa.");
          return;
        }
        setCategory(found);
        setForm({ name: found.name, slug: found.slug, description: found.description });
      })
      .catch((reason: unknown) => {
        if (!canceled) setError(reason instanceof Error ? reason.message : "Không tải được danh mục.");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [categoryId, invalidCategoryId]);

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !category) return;
    setBusy(true);
    setError("");
    try {
      await storeApi.updateCategory(token, category.id, {
        name: form.name.trim(),
        slug: slugify(form.slug),
        description: form.description.trim(),
      });
      router.push("/admin/categories");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được danh mục.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  const displayedError = invalidCategoryId ? "Mã danh mục không hợp lệ." : error;
  const isLoading = !invalidCategoryId && loading;

  return (
    <AdminShell
      active="categories"
      title="Sửa danh mục"
      description={category ? `Cập nhật thông tin cho ${category.name}.` : "Cập nhật thông tin danh mục."}
    >
      {displayedError && <p className="admin-alert" role="alert">{displayedError}</p>}
      {isLoading ? (
        <p className="admin-panel">Đang tải danh mục…</p>
      ) : category ? (
        <article className="admin-panel admin-category-editor">
          <header>
            <div>
              <h2>Thông tin danh mục</h2>
              <p>Danh mục #{category.id} · Các trường có dấu * là bắt buộc.</p>
            </div>
            <Link href="/admin/categories">Quay lại danh sách</Link>
          </header>
          <form className="admin-management-form" onSubmit={saveCategory}>
            <label>
              Tên danh mục *
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
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
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                maxLength={500}
              />
            </label>
            <div className="admin-form-actions">
              <button type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button>
              <Link className="admin-cancel-link" href="/admin/categories">Hủy</Link>
            </div>
          </form>
        </article>
      ) : (
        <article className="admin-panel">
          <p>Không thể mở danh mục này.</p>
          <Link href="/admin/categories">Quay lại danh sách</Link>
        </article>
      )}
    </AdminShell>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ProductImagesField } from "@/components/ProductImagesField";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Category } from "@/lib/store";

type ProductForm = {
  sku: string;
  name: string;
  description: string;
  imageUrl: string;
  imageUrls: string[];
  priceVnd: string;
  stock: string;
  categoryIds: number[];
};

const emptyForm: ProductForm = {
  sku: "",
  name: "",
  description: "",
  imageUrl: "",
  imageUrls: [],
  priceVnd: "",
  stock: "0",
  categoryIds: [],
};

export default function CreateProductPage() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  useEffect(() => {
    if (!token) return;
    storeApi.categories().then(({ items }) => setCategories(items)).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Không tải được danh mục sản phẩm.");
    });
  }, [token]);

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await storeApi.createProduct(token, {
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim() === "<p></p>" ? "" : form.description.trim(),
        imageUrl: (form.imageUrls[0] ?? form.imageUrl).trim(),
        imageUrls: form.imageUrls,
        priceVnd: Number(form.priceVnd),
        stock: Number(form.stock),
        categoryIds: form.categoryIds,
      });
      setForm(emptyForm);
      setNotice("Đã tạo sản phẩm.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tạo được sản phẩm.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="products"
      title="Thêm sản phẩm"
      description="Nhập thông tin và phân loại mặt hàng mới."
    >
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}
      <article className="admin-panel admin-product-editor">
        <header>
          <div>
            <h2>Thông tin sản phẩm</h2>
            <p>Các trường có dấu * là bắt buộc.</p>
          </div>
          <Link href="/admin/products">Quay lại danh sách</Link>
        </header>
        <form className="admin-management-form" onSubmit={createProduct}>
          <label>
            Mã SKU *
            <input
              value={form.sku}
              onChange={(event) => setForm({ ...form, sku: event.target.value })}
              required
              maxLength={64}
            />
          </label>
          <label>
            Tên sản phẩm *
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              maxLength={255}
            />
          </label>
          <label>
            Giá bán (₫) *
            <input
              type="number"
              min="1"
              value={form.priceVnd}
              onChange={(event) => setForm({ ...form, priceVnd: event.target.value })}
              required
            />
          </label>
          <label>
            Tồn kho *
            <input
              type="number"
              min="0"
              value={form.stock}
              onChange={(event) => setForm({ ...form, stock: event.target.value })}
              required
            />
          </label>
          <label className="wide">
            URL ảnh chính (nếu có)
            <input
              type="url"
              value={form.imageUrl}
              onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
            />
          </label>
          <div className="wide admin-description-field">
            Tải nhiều ảnh sản phẩm
            <ProductImagesField
              token={token}
              images={form.imageUrls}
              onChange={(imageUrls) =>
                setForm((current) => ({
                  ...current,
                  imageUrls,
                  imageUrl: current.imageUrls.includes(current.imageUrl)
                    ? imageUrls[0] ?? ""
                    : current.imageUrl || imageUrls[0] || "",
                }))
              }
            />
          </div>
          <div className="wide admin-description-field">
            Mô tả
            <RichTextEditor
              value={form.description}
              onChange={(description) => setForm({ ...form, description })}
            />
          </div>
          <fieldset className="wide admin-category-options">
            <legend>Danh mục sản phẩm</legend>
            {categories.map((category) => (
              <label key={category.id}>
                <input
                  type="checkbox"
                  checked={form.categoryIds.includes(category.id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      categoryIds: event.target.checked
                        ? [...form.categoryIds, category.id]
                        : form.categoryIds.filter((id) => id !== category.id),
                    })
                  }
                />
                {category.name}
              </label>
            ))}
            {categories.length === 0 && (
              <small>
                Chưa có danh mục. <Link href="/admin/categories">Tạo danh mục</Link>
              </small>
            )}
          </fieldset>
          <div className="admin-form-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Đang lưu…" : "Tạo sản phẩm"}
            </button>
            <Link className="admin-cancel-link" href="/admin/products">
              Hủy
            </Link>
          </div>
        </form>
      </article>
    </AdminShell>
  );
}

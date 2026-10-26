"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import { ProductImagesField } from "@/components/ProductImagesField";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Category, type Product } from "@/lib/store";

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

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [categories, setCategories] = useState<Category[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  useEffect(() => {
    if (!token) return;
    const productId = Number(id);
    if (!Number.isSafeInteger(productId) || productId < 1) {
      setError("Mã sản phẩm không hợp lệ.");
      setLoading(false);
      return;
    }

    let canceled = false;
    Promise.all([storeApi.adminProducts(token), storeApi.categories()])
      .then(([result, categoryResult]) => {
        if (canceled) return;
        const found = result.items.find((item) => item.id === productId);
        if (!found) {
          setError("Không tìm thấy sản phẩm cần sửa.");
          return;
        }
        setProduct(found);
        setCategories(categoryResult.items);
        setForm({
          sku: found.sku,
          name: found.name,
          description: found.description,
          imageUrl: found.imageUrl,
          imageUrls: found.images ?? [],
          priceVnd: String(found.priceVnd),
          stock: String(found.stock),
          categoryIds: found.categories.map((category) => category.id),
        });
      })
      .catch((reason: unknown) => {
        if (!canceled) {
          setError(reason instanceof Error ? reason.message : "Không tải được sản phẩm.");
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [id, token]);

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !product) return;
    setBusy(true);
    setError("");
    try {
      await storeApi.updateProduct(token, product.id, {
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim() === "<p></p>" ? "" : form.description.trim(),
        imageUrl: (form.imageUrls[0] ?? form.imageUrl).trim(),
        imageUrls: form.imageUrls,
        priceVnd: Number(form.priceVnd),
        stock: Number(form.stock),
        categoryIds: form.categoryIds,
      });
      router.push("/admin/products");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được sản phẩm.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="products"
      title="Sửa sản phẩm"
      description={product ? `Cập nhật thông tin cho ${product.name}.` : "Cập nhật thông tin sản phẩm."}
    >
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {loading ? (
        <p className="admin-panel">Đang tải sản phẩm…</p>
      ) : product ? (
        <article className="admin-panel admin-product-editor">
          <header>
            <div>
              <h2>Thông tin sản phẩm</h2>
              <p>Mã sản phẩm #{product.id} · Các trường có dấu * là bắt buộc.</p>
            </div>
            <Link href="/admin/products">Quay lại danh sách</Link>
          </header>
          <form className="admin-management-form" onSubmit={saveProduct}>
            <label>
              Mã SKU *
              <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required maxLength={64} />
            </label>
            <label>
              Tên sản phẩm *
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={255} />
            </label>
            <label>
              Giá bán (₫) *
              <input type="number" min="1" value={form.priceVnd} onChange={(event) => setForm({ ...form, priceVnd: event.target.value })} required />
            </label>
            <label>
              Tồn kho *
              <input type="number" min="0" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required />
            </label>
            <label className="wide">
              URL ảnh chính (nếu có)
              <input type="url" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} />
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
              <RichTextEditor value={form.description} onChange={(description) => setForm({ ...form, description })} />
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
                          : form.categoryIds.filter((categoryId) => categoryId !== category.id),
                      })
                    }
                  />
                  {category.name}
                </label>
              ))}
              {categories.length === 0 && (
                <small>Chưa có danh mục. <Link href="/admin/categories">Tạo danh mục</Link></small>
              )}
            </fieldset>
            <div className="admin-form-actions">
              <button type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button>
              <Link className="admin-cancel-link" href="/admin/products">Hủy</Link>
            </div>
          </form>
        </article>
      ) : (
        <article className="admin-panel">
          <p>Không thể mở sản phẩm này.</p>
          <Link href="/admin/products">Quay lại danh sách</Link>
        </article>
      )}
    </AdminShell>
  );
}

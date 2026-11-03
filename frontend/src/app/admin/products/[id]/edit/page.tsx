"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import { ProductImagesField } from "@/components/ProductImagesField";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useAuth } from "@/hooks/useAuth";
import {
  emptyProductForm,
  productFormFromProduct,
  updateProductInputFromForm,
  type ProductFormValues,
} from "@/lib/admin-product";
import { newIdempotencyKey } from "@/lib/idempotency";
import { storeApi, type Category, type Product } from "@/lib/store";

type StockForm = { delta: string; reason: string };
type StockAttempt = { fingerprint: string; key: string };

const emptyStockForm: StockForm = { delta: "", reason: "" };

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [form, setForm] = useState<ProductFormValues>(emptyProductForm);
  const [categories, setCategories] = useState<Category[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stockForm, setStockForm] = useState<StockForm>(emptyStockForm);
  const [stockAttempt, setStockAttempt] = useState<StockAttempt | null>(null);
  const [stockError, setStockError] = useState("");
  const [stockNotice, setStockNotice] = useState("");
  const [adjustingStock, setAdjustingStock] = useState(false);
  const productId = Number(id);
  const invalidProductId = !Number.isSafeInteger(productId) || productId < 1;

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  useEffect(() => {
    if (!token) return;
    if (invalidProductId) return;

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
        setForm(productFormFromProduct(found));
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
  }, [invalidProductId, productId, token]);

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !product) return;
    setBusy(true);
    setError("");
    try {
      const updated = await storeApi.updateProduct(
        token,
        product.id,
        updateProductInputFromForm(form, { currentSKU: product.sku }),
      );
      setProduct(updated);
      setForm(productFormFromProduct(updated));
      router.push("/admin/products");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được sản phẩm.");
    } finally {
      setBusy(false);
    }
  }

  async function adjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !product) return;

    const delta = Number(stockForm.delta);
    const reason = stockForm.reason.trim();
    if (!Number.isInteger(delta) || delta === 0) {
      setStockError("Thay đổi tồn kho phải là số nguyên khác 0.");
      return;
    }
    if (!reason) {
      setStockError("Vui lòng nhập lý do điều chỉnh tồn kho.");
      return;
    }

    // Reuse the same key for an unchanged retry; a new adjustment gets a new key.
    const fingerprint = `${delta}|${reason}`;
    const idempotencyKey =
      stockAttempt?.fingerprint === fingerprint ? stockAttempt.key : newIdempotencyKey();
    if (stockAttempt?.fingerprint !== fingerprint) {
      setStockAttempt({ fingerprint, key: idempotencyKey });
    }

    setAdjustingStock(true);
    setStockError("");
    setStockNotice("");
    try {
      const result = await storeApi.adjustProductStock(token, product.id, {
        delta,
        reason,
        idempotencyKey,
      });
      setProduct((current) =>
        current ? { ...current, stock: result.stock, stockVersion: result.stockVersion } : current,
      );
      setForm((current) => ({ ...current, stock: String(result.stock) }));
      setStockForm(emptyStockForm);
      setStockAttempt(null);
      setStockNotice(
        `Đã điều chỉnh tồn kho. Tồn hiện tại: ${result.stock} (phiên bản ${result.stockVersion}).`,
      );
    } catch (reason) {
      setStockError(reason instanceof Error ? reason.message : "Không điều chỉnh được tồn kho.");
    } finally {
      setAdjustingStock(false);
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  const displayedError = invalidProductId ? "Mã sản phẩm không hợp lệ." : error;
  const isLoading = !invalidProductId && loading;

  return (
    <AdminShell
      active="products"
      title="Sửa sản phẩm"
      description={
        product ? `Cập nhật thông tin cho ${product.name}.` : "Cập nhật thông tin sản phẩm."
      }
    >
      {displayedError && (
        <p className="admin-alert" role="alert">
          {displayedError}
        </p>
      )}
      {isLoading ? (
        <p className="admin-panel">Đang tải sản phẩm…</p>
      ) : product ? (
        <>
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
                <input
                  value={form.sku}
                  onChange={(event) => setForm({ ...form, sku: event.target.value })}
                  required
                  maxLength={64}
                />
                <small className="admin-field-hint">
                  Mã hiện tại có thể giữ nguyên. Mã mới phải có dạng TK + 10 ký tự in hoa hoặc số.
                </small>
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
                Giá thường (₫) *
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.regularPriceVnd}
                  onChange={(event) => setForm({ ...form, regularPriceVnd: event.target.value })}
                  required
                />
              </label>
              <label>
                Giá khuyến mãi (₫)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.discountPriceVnd}
                  onChange={(event) => setForm({ ...form, discountPriceVnd: event.target.value })}
                />
              </label>
              <label>
                Bắt đầu khuyến mãi
                <input
                  type="datetime-local"
                  value={form.discountStartsAt}
                  onChange={(event) => setForm({ ...form, discountStartsAt: event.target.value })}
                />
                <small className="admin-field-hint">Theo múi giờ UTC+07:00.</small>
              </label>
              <label>
                Kết thúc khuyến mãi
                <input
                  type="datetime-local"
                  value={form.discountEndsAt}
                  onChange={(event) => setForm({ ...form, discountEndsAt: event.target.value })}
                />
                <small className="admin-field-hint">Theo múi giờ UTC+07:00.</small>
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
                        ? (imageUrls[0] ?? "")
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
                            : form.categoryIds.filter((categoryId) => categoryId !== category.id),
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
                  {busy ? "Đang lưu…" : "Lưu thay đổi"}
                </button>
                <Link className="admin-cancel-link" href="/admin/products">
                  Hủy
                </Link>
              </div>
            </form>
          </article>

          <article className="admin-panel admin-product-editor admin-stock-panel">
            <header>
              <div>
                <h2>Điều chỉnh tồn kho</h2>
                <p>
                  Tồn kho được cập nhật qua nhật ký điều chỉnh, không ghi đè khi lưu thông tin sản
                  phẩm.
                </p>
              </div>
            </header>
            <div className="admin-stock-summary">
              <div>
                <span>Tồn hiện tại</span>
                <strong>{product.stock}</strong>
              </div>
              <div>
                <span>Phiên bản tồn kho</span>
                <strong>{product.stockVersion}</strong>
              </div>
            </div>
            {stockError && (
              <p className="admin-alert" role="alert">
                {stockError}
              </p>
            )}
            {stockNotice && (
              <p className="admin-success" role="status">
                {stockNotice}
              </p>
            )}
            <form className="admin-management-form" onSubmit={adjustStock}>
              <label>
                Thay đổi tồn kho *
                <input
                  type="number"
                  step="1"
                  placeholder="Ví dụ: -2 hoặc 5"
                  value={stockForm.delta}
                  onChange={(event) => setStockForm({ ...stockForm, delta: event.target.value })}
                  required
                />
                <small className="admin-field-hint">
                  Số dương để nhập thêm, số âm để giảm tồn kho.
                </small>
              </label>
              <label>
                Lý do điều chỉnh *
                <input
                  value={stockForm.reason}
                  onChange={(event) => setStockForm({ ...stockForm, reason: event.target.value })}
                  placeholder="Ví dụ: hàng hỏng, kiểm kê"
                  required
                  maxLength={255}
                />
              </label>
              <div className="admin-form-actions">
                <button type="submit" disabled={adjustingStock}>
                  {adjustingStock ? "Đang cập nhật…" : "Ghi nhận điều chỉnh"}
                </button>
              </div>
            </form>
          </article>
        </>
      ) : (
        <article className="admin-panel">
          <p>Không thể mở sản phẩm này.</p>
          <Link href="/admin/products">Quay lại danh sách</Link>
        </article>
      )}
    </AdminShell>
  );
}

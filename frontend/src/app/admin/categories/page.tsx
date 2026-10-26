"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Category, type Product } from "@/lib/store";

export default function AdminCategoriesPage() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [categoryList, productList] = await Promise.all([
        storeApi.categories(),
        storeApi.adminProducts(token),
      ]);
      setCategories(categoryList.items);
      setProducts(productList.items);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu danh mục.");
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

  async function deleteCategory(category: Category) {
    if (
      !token ||
      !window.confirm(
        `Xóa danh mục “${category.name}”? Sản phẩm sẽ được giữ lại nhưng bỏ liên kết danh mục này.`,
      )
    ) return;
    setError("");
    setNotice("");
    try {
      await storeApi.deleteCategory(token, category.id);
      setNotice("Đã xóa danh mục và các liên kết sản phẩm.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xóa được danh mục.");
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="categories"
      title="Quản lý danh mục"
      description="Tổ chức thực đơn và gán sản phẩm vào nhiều danh mục."
    >
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}
      <article className="admin-panel admin-management-list">
        <header>
          <div>
            <h2>Danh mục</h2>
            <p>{categories.length} danh mục · {products.length} sản phẩm</p>
          </div>
          <Link href="/admin/categories/create">Thêm danh mục +</Link>
        </header>
        <div className="admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>TÊN</th>
                <th>SLUG</th>
                <th>SẢN PHẨM</th>
                <th>MÔ TẢ</th>
                <th>THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => {
                const count = products.filter((product) =>
                  product.categories.some((item) => item.id === category.id),
                ).length;
                return (
                  <tr key={category.id}>
                    <td><strong>{category.name}</strong></td>
                    <td><code>{category.slug}</code></td>
                    <td>{count}</td>
                    <td>{category.description || "—"}</td>
                    <td>
                      <div className="admin-row-actions">
                        <Link href={`/admin/categories/${category.id}/edit`}>Sửa</Link>
                        <button type="button" className="danger" onClick={() => void deleteCategory(category)}>
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && categories.length === 0 && (
                <tr><td colSpan={5} className="admin-empty">Chưa có danh mục.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={5} className="admin-empty">Đang tải danh mục…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </AdminShell>
  );
}

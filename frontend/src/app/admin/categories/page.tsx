"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Category } from "@/lib/store";

export default function AdminCategoriesPage() {
  const router = useRouter();
  const { token, ready } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const {
    data,
    error: queryError,
    isLoading: loading,
    refetch: refresh,
  } = useQuery({
    queryKey: ["admin", "categories", token],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) throw new Error("Cần đăng nhập để tải danh mục.");
      const [categoryList, productList] = await Promise.all([
        storeApi.categories(),
        storeApi.adminProducts(token),
      ]);
      return { categories: categoryList.items, products: productList.items };
    },
  });
  const categories = data?.categories ?? [];
  const products = data?.products ?? [];
  const error = queryError instanceof Error
    ? queryError.message
    : queryError
      ? "Không tải được dữ liệu danh mục."
      : "";

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  async function deleteCategory(category: Category) {
    if (
      !token ||
      !window.confirm(
        `Xóa danh mục “${category.name}”? Sản phẩm sẽ được giữ lại nhưng bỏ liên kết danh mục này.`,
      )
    ) return;
    setActionError("");
    setNotice("");
    try {
      await storeApi.deleteCategory(token, category.id);
      setNotice("Đã xóa danh mục và các liên kết sản phẩm.");
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Không xóa được danh mục.");
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="categories"
      title="Quản lý danh mục"
      description="Tổ chức thực đơn và gán sản phẩm vào nhiều danh mục."
    >
      {(error || actionError) && <p className="admin-alert" role="alert">{actionError || error}</p>}
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

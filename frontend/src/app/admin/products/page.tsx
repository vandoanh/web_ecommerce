"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/hooks/useAuth";
import { storeApi, type Product } from "@/lib/store";

const money = (amount: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

export default function AdminProductsPage() {
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
    data: products = [],
    error: queryError,
    isLoading: loading,
    refetch: refresh,
  } = useQuery({
    queryKey: ["admin", "products", token],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) throw new Error("Cần đăng nhập để tải sản phẩm.");
      return (await storeApi.adminProducts(token)).items;
    },
  });
  const error = queryError instanceof Error
    ? queryError.message
    : queryError
      ? "Không tải được danh sách sản phẩm."
      : "";

  useEffect(() => {
    if (ready && !token) router.replace("/admin/login");
  }, [ready, router, token]);

  async function deleteProduct(product: Product) {
    if (!token || !window.confirm(`Xóa sản phẩm “${product.name}”?`)) return;
    setActionError("");
    setNotice("");
    try {
      await storeApi.deleteProduct(token, product.id);
      setNotice("Đã xóa sản phẩm.");
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Không xóa được sản phẩm.");
    }
  }

  if (!ready || !token) return <main className="admin-loading">Đang kiểm tra quyền truy cập…</main>;

  return (
    <AdminShell
      active="products"
      title="Quản lý sản phẩm"
      description="Tạo, cập nhật, phân loại và xóa sản phẩm."
    >
      {(error || actionError) && <p className="admin-alert" role="alert">{actionError || error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}
      <article className="admin-panel admin-management-list">
        <header>
          <div>
            <h2>Sản phẩm</h2>
            <p>{products.length} mặt hàng</p>
          </div>
          <Link href="/admin/products/create">Thêm sản phẩm +</Link>
        </header>
        <div className="admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>SẢN PHẨM</th>
                <th>GIÁ</th>
                <th>TỒN KHO</th>
                <th>DANH MỤC</th>
                <th>THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="admin-product-cell">
                      <Image
                        src={product.imageUrl || "https://placehold.co/80x80?text=TK"}
                        alt=""
                        width={48}
                        height={48}
                        unoptimized
                      />
                      <span>
                        <strong>{product.name}</strong>
                        <small>{product.sku}</small>
                      </span>
                    </div>
                  </td>
                  <td>{money(product.priceVnd)}</td>
                  <td>{product.stock}</td>
                  <td>{product.categories.map((category) => category.name).join(", ") || "—"}</td>
                  <td>
                    <div className="admin-row-actions">
                      <Link href={`/admin/products/${product.id}/edit`}>Sửa</Link>
                      <button type="button" className="danger" onClick={() => void deleteProduct(product)}>
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && products.length === 0 && (
                <tr><td colSpan={5} className="admin-empty">Chưa có sản phẩm.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={5} className="admin-empty">Đang tải sản phẩm…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </AdminShell>
  );
}

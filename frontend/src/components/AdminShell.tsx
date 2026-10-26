"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { SharedFooter, SharedHeader } from "@/components/SharedChrome";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import "@/app/admin/admin.css";

type AdminShellProps = {
  active: "overview" | "products" | "categories" | "orders" | "contacts";
  title: string;
  description: string;
  toolbar?: ReactNode;
  children: ReactNode;
};

export function AdminShell({ active, title, description, toolbar, children }: AdminShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { logout } = useAuth({ storageKey: "admin-token", logoutTo: "/admin/login" });

  return (
    <div className="admin-app">
      <aside className={`admin-sidebar${menuOpen ? " open" : ""}`}>
        <Link className="admin-brand" href="/admin">
          <BrandLogo size={48} className="admin-brand-logo" />
          <span>
            ADMIN <small>TUẤN KHANG</small>
          </span>
        </Link>
        <div className="admin-user">
          <span className="admin-avatar">AD</span>
          <span>
            <strong>Quản trị viên</strong>
            <small>Đang hoạt động</small>
          </span>
        </div>
        <div className="admin-menu-label">CỬA HÀNG</div>
        <nav>
          <Link className={active === "overview" ? "selected" : ""} href="/admin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75h6.5v6.5h-6.5zm10 0h6.5v6.5h-6.5zm-10 10h6.5v6.5h-6.5zm10 0h6.5v6.5h-6.5z" />
            </svg>
            <span>Tổng quan</span>
          </Link>
          <Link className={active === "products" ? "selected" : ""} href="/admin/products">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 8.25V6a3.75 3.75 0 1 0-7.5 0v2.25m-4.5 0h16.5l1.125 12H2.625l1.125-12Z" />
            </svg>
            <span>Sản phẩm</span>
          </Link>
          <Link className={active === "categories" ? "selected" : ""} href="/admin/categories">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h6l1.5 1.5h9v9.75a2.25 2.25 0 0 1-2.25 2.25h-12a2.25 2.25 0 0 1-2.25-2.25V6.75Zm0 3h16.5" />
            </svg>
            <span>Danh mục</span>
          </Link>
          <Link className={active === "orders" ? "selected" : ""} href="/admin/orders">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75h9A2.25 2.25 0 0 1 18.75 6v14.25H5.25V6A2.25 2.25 0 0 1 7.5 3.75Zm2.25 0V2.25h4.5v1.5m-6 6h7.5m-7.5 3.75h7.5m-7.5 3.75h4.5" />
            </svg>
            <span>Đơn hàng</span>
          </Link>
          <Link className={active === "contacts" ? "selected" : ""} href="/admin/contacts">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5v13.5H3.75zm0 3.75h16.5M7.5 13.5h4.5m-4.5 3h7.5" />
            </svg>
            <span>Liên hệ</span>
          </Link>
        </nav>
        <button className="admin-logout" onClick={logout}>
          ↪ <span>Đăng xuất</span>
        </button>
      </aside>
      <main className="admin-main">
        <SharedHeader className="admin-navbar" showBrand={false}>
          <button aria-label="Toggle menu" onClick={() => setMenuOpen((open) => !open)}>
            ☰
          </button>
          <span>
            Cửa hàng <b>/</b> {title}
          </span>
          <Link href="/">Xem cửa hàng ↗</Link>
        </SharedHeader>
        <section className="admin-content">
          <div className="admin-page-title">
            <div>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            {toolbar}
          </div>
          {children}
          <SharedFooter className="admin-footer">© 2026 Tuấn Khang · Quản trị cửa hàng</SharedFooter>
        </section>
      </main>
      {menuOpen && (
        <button
          className="admin-backdrop"
          aria-label="Đóng menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

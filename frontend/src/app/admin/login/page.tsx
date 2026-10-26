"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { BrandLogo } from "@/components/BrandLogo";
import { SharedFooter } from "@/components/SharedChrome";
import "../login.css";

export default function AdminLoginPage() {
  const router = useRouter();
  const { token, ready, login } = useAuth({
    storageKey: "admin-token",
    portal: "admin",
    redirectTo: "/admin",
    logoutTo: "/admin/login",
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (ready && token) router.replace("/admin");
  }, [ready, router, token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    login.mutate({ username: username.trim(), password, remember });
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-box" aria-label="Đăng nhập quản trị">
        <a className="admin-login-brand" href="/admin">
          <BrandLogo size={104} className="admin-login-logo" />
        </a>
        <div className="admin-login-card">
          <div className="admin-login-card-body">
            <p className="admin-login-prompt">Đăng nhập để bắt đầu phiên làm việc</p>
            {(login.error || notice) && (
              <div className="admin-login-error" role="alert">
                {login.error?.message ?? notice}
              </div>
            )}
            <form onSubmit={submit}>
              <label className="admin-login-field">
                <span className="sr-only">Email hoặc tên đăng nhập</span>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="Email hoặc tên đăng nhập"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
                <span className="admin-login-addon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21.75 6.75v10.5A2.25 2.25 0 0 1 19.5 19.5h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0-8.39 6.29a2.25 2.25 0 0 1-2.72 0L2.25 6.75"
                    />
                  </svg>
                </span>
              </label>
              <label className="admin-login-field">
                <span className="sr-only">Mật khẩu</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Mật khẩu"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <span className="admin-login-addon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="4.5" y="10.5" width="15" height="11.25" rx="2.25" />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 10.5V6.75a3.75 3.75 0 1 1 7.5 0v3.75"
                    />
                  </svg>
                </span>
              </label>
              <div className="admin-login-actions">
                <label className="admin-login-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />{" "}
                  <span>Ghi nhớ đăng nhập</span>
                </label>
                <button type="submit" disabled={login.isPending}>
                  {login.isPending ? "Đang đăng nhập…" : "Đăng nhập"}
                </button>
              </div>
            </form>
            <div className="admin-login-links">
              <a
                href="#forgot"
                onClick={(event) => {
                  event.preventDefault();
                  login.reset();
                  setNotice("Vui lòng liên hệ quản trị viên để đặt lại mật khẩu.");
                }}
              >
                Quên mật khẩu?
              </a>
              <a
                href="#register"
                onClick={(event) => {
                  event.preventDefault();
                  login.reset();
                  setNotice("Tài khoản mới được tạo bởi quản trị viên hệ thống.");
                }}
              >
                Đăng ký tài khoản mới
              </a>
            </div>
          </div>
        </div>
        <SharedFooter className="admin-login-footer">© 2026 Tuấn Khang · Quản trị cửa hàng</SharedFooter>
      </section>
    </main>
  );
}

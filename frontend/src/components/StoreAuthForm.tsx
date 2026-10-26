"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { SharedFooter } from "@/components/SharedChrome";
import { ClientMenu } from "@/components/ClientMenu";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { authApi } from "@/lib/auth";
import { setAccessToken } from "@/lib/storage";

export function StoreAuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { login } = useAuth({ storageKey: "store-token", redirectTo: "/" });
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "login") {
      login.mutate({ username: username.trim(), password, remember });
      return;
    }
    setBusy(true);
    try {
      const result = await authApi.register({
        username: username.trim(),
        email: email.trim(),
        password,
      });
      setAccessToken(result.accessToken, remember, "store-token");
      router.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tạo tài khoản.");
    } finally {
      setBusy(false);
    }
  }

  const message = error || login.error?.message;
  const isBusy = busy || login.isPending;
  return (
    <main className="store-auth-page">
      <Link className="store-brand" href="/">
        <BrandLogo size={120} className="store-auth-logo" />
      </Link>
      <ClientMenu />
      <section className="store-auth-card">
        <span className="store-kicker">TÀI KHOẢN KHÁCH HÀNG</span>
        <h1>{mode === "login" ? "Chào mừng bạn trở lại" : "Tạo tài khoản mua sắm"}</h1>
        <p>
          {mode === "login"
            ? "Đăng nhập để đặt hàng và theo dõi đơn hàng."
            : "Đăng ký miễn phí để bắt đầu đặt hàng."}
        </p>
        {message && (
          <div className="store-message store-error" role="alert">
            {message}
          </div>
        )}
        <form className="store-auth-form" onSubmit={submit}>
          <label>
            Tên đăng nhập
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              minLength={3}
              maxLength={64}
              autoComplete="username"
              required
            />
          </label>
          {mode === "register" && (
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
          )}
          <label>
            Mật khẩu
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>
          <label className="store-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />{" "}
            Ghi nhớ đăng nhập trên thiết bị này
          </label>
          <button className="store-submit-order" type="submit" disabled={isBusy}>
            {isBusy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
          </button>
        </form>
        <div className="store-auth-switch">
          {mode === "login" ? (
            <>
              Chưa có tài khoản? <Link href="/register">Đăng ký</Link>
            </>
          ) : (
            <>
              Đã có tài khoản? <Link href="/login">Đăng nhập</Link>
            </>
          )}
        </div>
        <Link className="store-auth-back" href="/">
          ← Quay lại cửa hàng
        </Link>
      </section>
      <p className="store-auth-admin-note">
        Đăng nhập quản trị? <Link href="/admin/login">Vào trang admin</Link>
      </p>
      <SharedFooter className="store-auth-footer">
        © 2026 Tuấn Khang · Thêm món ngon, ấm vị bữa cơm nhà.
      </SharedFooter>
    </main>
  );
}

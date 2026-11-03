import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoreAuthForm } from "./StoreAuthForm";
import { cleanup } from "@testing-library/react";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ login: { mutate, isPending: false, error: null } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

describe("StoreAuthForm", () => {
  beforeEach(() => {
    cleanup();
    mutate.mockClear();
  });

  it("keeps customer login focused without the storefront main navigation", () => {
    render(<StoreAuthForm mode="login" />);

    expect(screen.getByRole("heading", { name: "Chào mừng bạn trở lại" })).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Điều hướng cửa hàng" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Quay lại cửa hàng" })).toHaveAttribute("href", "/");
  });

  it("submits the existing customer login contract", () => {
    render(<StoreAuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("Tên đăng nhập"), { target: { value: "  customer  " } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(mutate).toHaveBeenCalledWith({
      username: "customer",
      password: "password123",
      remember: true,
    });
  });
});

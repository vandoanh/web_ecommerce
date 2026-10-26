export type LoginCredentials = {
  username: string;
  password: string;
};

export type LoginResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: {
    id: number;
    username: string;
    email: string;
    roles: string[];
    groups: string[];
  };
};

export type LoginPortal = "customer" | "admin";

const apiURL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const authApi = {
  async login(
    credentials: LoginCredentials,
    portal: LoginPortal = "customer",
  ): Promise<LoginResponse> {
    const endpoint = portal === "admin" ? "/api/v1/admin/auth/login" : "/api/v1/auth/login";
    const response = await fetch(apiURL + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const result = (await response.json()) as LoginResponse & { error?: string };
    if (!response.ok) {
      throw new Error(result.error ?? "Tên đăng nhập hoặc mật khẩu không chính xác.");
    }
    return result;
  },
  async register(input: LoginCredentials & { email: string }): Promise<LoginResponse> {
    const response = await fetch(apiURL + "/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = (await response.json()) as LoginResponse & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Không thể tạo tài khoản.");
    return result;
  },
};

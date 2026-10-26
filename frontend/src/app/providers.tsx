"use client";

import { ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import type { ReactNode } from "react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={viVN}
        theme={{
          token: {
            colorPrimary: "#2999c9",
            colorInfo: "#2999c9",
            borderRadius: 8,
            fontFamily: "Inter, Arial, sans-serif",
          },
        }}
      >
        {children}
      </ConfigProvider>
    </QueryClientProvider>
  );
}

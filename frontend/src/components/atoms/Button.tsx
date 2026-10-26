import type { ButtonHTMLAttributes, ReactNode } from "react";
export function Button({
  children,
  ...props
}: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2 font-semibold transition disabled:opacity-50 ${props.className ?? "bg-indigo-600 text-white hover:bg-indigo-500"}`}
    >
      {children}
    </button>
  );
}

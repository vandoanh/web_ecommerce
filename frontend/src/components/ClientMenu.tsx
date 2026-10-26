import Link from "next/link";

type ClientMenuProps = {
  current?: "home" | "products" | "about";
  onHomePage?: boolean;
};

const menuItems = [
  { id: "home", label: "Trang chủ", href: "#home", pageHref: "/#home" },
  { id: "products", label: "Thực đơn", href: "#products", pageHref: "/#products" },
  { id: "about", label: "Về chúng tôi", href: "#about", pageHref: "/#about" },
] as const;

export function ClientMenu({ current, onHomePage = false }: ClientMenuProps) {
  return (
    <nav className="store-client-menu" aria-label="Điều hướng cửa hàng">
      {menuItems.map((item) => (
        <Link
          key={item.id}
          className={current === item.id ? "active" : undefined}
          href={onHomePage ? item.href : item.pageHref}
          aria-current={current === item.id ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

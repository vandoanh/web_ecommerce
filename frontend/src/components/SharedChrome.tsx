import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";

type SharedHeaderProps = {
  className: string;
  children: ReactNode;
  brandClassName?: string;
  logoClassName?: string;
  brandSize?: number;
  showBrand?: boolean;
};

export function SharedHeader({
  className,
  children,
  brandClassName = "store-brand",
  logoClassName = "store-header-logo",
  brandSize = 64,
  showBrand = true,
}: SharedHeaderProps) {
  return (
    <header className={className}>
      {showBrand && (
        <Link className={brandClassName} href="/">
          <BrandLogo size={brandSize} className={logoClassName} />
        </Link>
      )}
      {children}
    </header>
  );
}

export function SharedFooter({ className, children }: { className: string; children: ReactNode }) {
  return <footer className={className}>{children}</footer>;
}

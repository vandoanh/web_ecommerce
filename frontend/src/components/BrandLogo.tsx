import Image from "next/image";

export function BrandLogo({ size, className }: { size: number; className?: string }) {
  return (
    <Image
      className={className}
      src="/logotk.png"
      alt="Tuấn Khang"
      width={size}
      height={size}
      priority
    />
  );
}

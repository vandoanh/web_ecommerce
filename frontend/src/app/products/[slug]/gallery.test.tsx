// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductDetailPage from "@/app/products/[slug]/page";

const mocks = vi.hoisted(() => ({
  product: {
    id: 1,
    sku: "SKU-1",
    name: "Test product",
    description: "",
    priceVnd: 1000,
    stock: 2,
    imageUrl: "/one.jpg",
    images: ["/one.jpg", "/two.jpg"],
    categories: [],
  },
  useParams: vi.fn(() => ({ slug: "test-product-1" })),
  useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn() })),
  productApi: vi.fn(),
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />;
  },
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useParams: mocks.useParams, useRouter: mocks.useRouter }));
vi.mock("@/lib/store", () => ({
  storeApi: { product: mocks.productApi, saveCart: vi.fn() },
}));
vi.mock("@/lib/cart", () => ({
  loadStoreCart: vi.fn(async () => ({ cartId: "cart", items: [] })),
}));
vi.mock("@/components/ClientMenu", () => ({ ClientMenu: () => null }));
vi.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));
vi.mock("@/components/SharedChrome", () => ({
  SharedHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  SharedFooter: () => <footer />,
}));
vi.mock("@/components/SafeHtml", () => ({ SafeHtml: () => null }));

describe("product detail gallery", () => {
  beforeEach(() => {
    cleanup();
    mocks.productApi.mockResolvedValue({ ...mocks.product });
  });

  it("supports keyboard and thumbnail navigation with accessible controls", async () => {
    render(<ProductDetailPage />);
    const mainImage = await screen.findByRole("img", { name: "Test product, ảnh 1" });
    expect(screen.getByRole("region", { name: "Thư viện ảnh sản phẩm" })).toHaveAttribute(
      "aria-roledescription",
      "carousel",
    );
    expect(screen.getByRole("button", { name: "Ảnh trước" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ảnh tiếp theo" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("region", { name: "Thư viện ảnh sản phẩm" }), {
      key: "ArrowRight",
    });
    expect(await screen.findByRole("img", { name: "Test product, ảnh 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem ảnh 1" }));
    expect(await screen.findByRole("img", { name: "Test product, ảnh 1" })).toBeInTheDocument();
    expect(mainImage).toBeInTheDocument();
  });

  it("uses a fallback after the active gallery image errors", async () => {
    render(<ProductDetailPage />);
    const image = await screen.findByRole("img", { name: "Test product, ảnh 1" });
    fireEvent.error(image);
    expect(
      await screen.findByRole("img", { name: "Ảnh minh họa thay thế cho Test product" }),
    ).toHaveAttribute("src", "/food-placeholder.svg");
  });

  it("uses touch swipes to advance the gallery", async () => {
    render(<ProductDetailPage />);
    await screen.findByRole("img", { name: "Test product, ảnh 1" });
    const region = screen.getAllByRole("region", { name: "Thư viện ảnh sản phẩm" })[0];
    fireEvent.touchStart(region, { changedTouches: [{ clientX: 200, clientY: 40 }] });
    fireEvent.touchEnd(region, { changedTouches: [{ clientX: 100, clientY: 45 }] });
    expect(await screen.findByRole("img", { name: "Test product, ảnh 2" })).toBeInTheDocument();
  });
});

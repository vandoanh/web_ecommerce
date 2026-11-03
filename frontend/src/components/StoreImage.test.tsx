import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoreImage } from "@/components/StoreImage";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />;
  },
}));

describe("StoreImage", () => {
  it("switches to an accessible placeholder using React state and stays stable if it fails", () => {
    const { rerender } = render(
      <StoreImage
        src="https://example.invalid/item.jpg"
        alt="Product photo"
        fallbackAlt="Illustrative replacement"
        width={100}
        height={100}
      />,
    );
    const original = screen.getByRole("img", { name: "Product photo" });
    fireEvent.error(original);
    const fallback = screen.getByRole("img", { name: "Illustrative replacement" });
    expect(fallback.getAttribute("src")).toBe("/food-placeholder.svg");
    fireEvent.error(fallback);
    rerender(
      <StoreImage
        src="https://example.invalid/item.jpg"
        alt="Product photo"
        fallbackAlt="Illustrative replacement"
        width={100}
        height={100}
      />,
    );
    expect(screen.getByRole("img", { name: "Illustrative replacement" })).toHaveAttribute(
      "src",
      "/food-placeholder.svg",
    );
  });
});

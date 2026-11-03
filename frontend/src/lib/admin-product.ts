import type { Product, ProductCreateInput, ProductUpdateInput } from "@/lib/store";
import { buildDiscountSchedule, toStoreDateTimeLocal } from "@/lib/product-pricing";

export type ProductFormValues = {
  sku: string;
  name: string;
  description: string;
  imageUrl: string;
  imageUrls: string[];
  regularPriceVnd: string;
  discountPriceVnd: string;
  discountStartsAt: string;
  discountEndsAt: string;
  stock: string;
  isActive: boolean;
  categoryIds: number[];
};

export class ProductFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductFormError";
  }
}

export const emptyProductForm: ProductFormValues = {
  sku: "",
  name: "",
  description: "",
  imageUrl: "",
  imageUrls: [],
  regularPriceVnd: "",
  discountPriceVnd: "",
  discountStartsAt: "",
  discountEndsAt: "",
  stock: "0",
  isActive: true,
  categoryIds: [],
};

const generatedSKUPattern = /^TK[A-Z0-9]{10}$/;

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ProductFormError(`${label} phải là số nguyên dương.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ProductFormError(`${label} phải là số nguyên không âm.`);
  }
  return parsed;
}

function cleanDescription(description: string): string {
  const trimmed = description.trim();
  return trimmed === "<p></p>" ? "" : trimmed;
}

function priceScheduleFromForm(form: ProductFormValues, regularPriceVnd: number) {
  return buildDiscountSchedule({
    regularPriceVnd,
    discountPriceVnd: form.discountPriceVnd,
    discountStartsAt: form.discountStartsAt,
    discountEndsAt: form.discountEndsAt,
  });
}

function editableProductFields(form: ProductFormValues) {
  return {
    name: form.name.trim(),
    description: cleanDescription(form.description),
    imageUrl: (form.imageUrls[0] ?? form.imageUrl).trim(),
    imageUrls: [...form.imageUrls],
    isActive: form.isActive,
    categoryIds: [...form.categoryIds],
  };
}

export function productFormFromProduct(product: Product): ProductFormValues {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    imageUrls: product.images ?? [],
    regularPriceVnd: String(product.regularPriceVnd ?? product.priceVnd),
    discountPriceVnd:
      product.discountPriceVnd === null || product.discountPriceVnd === undefined
        ? ""
        : String(product.discountPriceVnd),
    discountStartsAt: toStoreDateTimeLocal(product.discountStartsAt),
    discountEndsAt: toStoreDateTimeLocal(product.discountEndsAt),
    stock: String(product.stock),
    isActive: product.isActive,
    categoryIds: product.categories.map((category) => category.id),
  };
}

/**
 * Creates the admin product write body without a SKU: the backend generates
 * the product code and returns it in the response.
 */
export function createProductInputFromForm(form: ProductFormValues): ProductCreateInput {
  if (!form.name.trim()) throw new ProductFormError("Tên sản phẩm không được để trống.");
  const regularPriceVnd = parsePositiveInteger(form.regularPriceVnd, "Giá thường");
  return {
    ...editableProductFields(form),
    regularPriceVnd,
    ...priceScheduleFromForm(form, regularPriceVnd),
    stock: parseNonNegativeInteger(form.stock, "Tồn kho"),
  };
}

/**
 * Builds a full product update without stock. Stock changes are deliberately
 * sent through the audited stock-adjustment endpoint instead.
 */
export function updateProductInputFromForm(
  form: ProductFormValues,
  options: { currentSKU?: string } = {},
): ProductUpdateInput {
  if (!form.name.trim()) throw new ProductFormError("Tên sản phẩm không được để trống.");
  const sku = form.sku.trim();
  if (!sku) throw new ProductFormError("Mã SKU không được để trống.");
  if (options.currentSKU && sku !== options.currentSKU && !generatedSKUPattern.test(sku)) {
    throw new ProductFormError("Mã SKU mới phải gồm tiền tố TK và 10 ký tự chữ in hoa hoặc số.");
  }
  const regularPriceVnd = parsePositiveInteger(form.regularPriceVnd, "Giá thường");
  return {
    ...editableProductFields(form),
    sku,
    regularPriceVnd,
    ...priceScheduleFromForm(form, regularPriceVnd),
  };
}

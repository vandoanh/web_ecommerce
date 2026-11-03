export const STORE_TIME_ZONE = "Asia/Ho_Chi_Minh";
export const STORE_TIME_ZONE_OFFSET = "+07:00";

const STORE_OFFSET_MS = 7 * 60 * 60 * 1000;

export class ProductDiscountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductDiscountError";
  }
}

export type DiscountScheduleValues = {
  regularPriceVnd: number;
  discountPriceVnd: string;
  discountStartsAt: string;
  discountEndsAt: string;
};

export type DiscountSchedule = {
  discountPriceVnd: number | null;
  discountStartsAt: string | null;
  discountEndsAt: string | null;
};

/**
 * Converts a datetime-local value entered in the store timezone (UTC+07:00)
 * into an RFC3339 timestamp with an explicit offset for the API.
 */
export function storeDateTimeLocalToISO(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 7,
      Number(minute),
      Number(second),
    ),
  );
  if (Number.isNaN(date.getTime())) return null;

  // Reject impossible values that Date normalizes, such as 30 February.
  if (
    toStoreDateTimeLocal(date.toISOString()).slice(0, 16) !==
    `${year}-${month}-${day}T${hour}:${minute}`
  ) {
    return null;
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${STORE_TIME_ZONE_OFFSET}`;
}

/**
 * Converts an API timestamp to a datetime-local value in the store timezone.
 */
export function toStoreDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + STORE_OFFSET_MS).toISOString().slice(0, 16);
}

export function formatStoreDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: STORE_TIME_ZONE,
  }).format(date);
}

export function discountScheduleText(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): string {
  if (!startsAt || !endsAt) return "";
  return `${formatStoreDateTime(startsAt)} – ${formatStoreDateTime(endsAt)}`;
}

export function buildDiscountSchedule(values: DiscountScheduleValues): DiscountSchedule {
  const discountPrice = values.discountPriceVnd.trim();
  const startsAt = values.discountStartsAt.trim();
  const endsAt = values.discountEndsAt.trim();

  if (!discountPrice && !startsAt && !endsAt) {
    return { discountPriceVnd: null, discountStartsAt: null, discountEndsAt: null };
  }
  if (!discountPrice || !startsAt || !endsAt) {
    throw new ProductDiscountError(
      "Vui lòng nhập đầy đủ giá khuyến mãi, thời gian bắt đầu và kết thúc.",
    );
  }

  const price = Number(discountPrice);
  if (!Number.isInteger(price) || price <= 0 || price >= values.regularPriceVnd) {
    throw new ProductDiscountError("Giá khuyến mãi phải là số nguyên dương và nhỏ hơn giá thường.");
  }

  const startsAtISO = storeDateTimeLocalToISO(startsAt);
  const endsAtISO = storeDateTimeLocalToISO(endsAt);
  if (!startsAtISO || !endsAtISO) {
    throw new ProductDiscountError("Thời gian khuyến mãi không hợp lệ.");
  }
  if (Date.parse(endsAtISO) <= Date.parse(startsAtISO)) {
    throw new ProductDiscountError("Thời gian kết thúc phải sau thời gian bắt đầu.");
  }

  return {
    discountPriceVnd: price,
    discountStartsAt: startsAtISO,
    discountEndsAt: endsAtISO,
  };
}

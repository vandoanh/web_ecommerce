import { describe, expect, it } from "vitest";
import {
  buildDiscountSchedule,
  discountScheduleText,
  formatStoreDateTime,
  ProductDiscountError,
  storeDateTimeLocalToISO,
  toStoreDateTimeLocal,
} from "./product-pricing";

describe("store timezone conversion", () => {
  it("converts datetime-local values from UTC+07:00 to RFC3339", () => {
    expect(storeDateTimeLocalToISO("2026-11-03T00:00")).toBe("2026-11-03T00:00:00+07:00");
    expect(storeDateTimeLocalToISO("2026-11-10T18:30:45")).toBe("2026-11-10T18:30:45+07:00");
  });

  it("converts API timestamps back into UTC+07:00 datetime-local values", () => {
    expect(toStoreDateTimeLocal("2026-11-02T17:00:00Z")).toBe("2026-11-03T00:00");
    expect(toStoreDateTimeLocal("2026-11-10T11:30:00Z")).toBe("2026-11-10T18:30");
    expect(toStoreDateTimeLocal(null)).toBe("");
  });

  it("rejects invalid and impossible datetime-local values", () => {
    expect(storeDateTimeLocalToISO("")).toBeNull();
    expect(storeDateTimeLocalToISO("not-a-date")).toBeNull();
    expect(storeDateTimeLocalToISO("2026-02-30T10:00")).toBeNull();
  });

  it("formats schedule values in the store timezone", () => {
    expect(formatStoreDateTime("2026-11-02T17:00:00Z")).toContain("00:00");
    expect(discountScheduleText("2026-11-02T17:00:00Z", "2026-11-09T17:00:00Z")).toContain("–");
    expect(discountScheduleText(null, null)).toBe("");
  });
});

describe("discount schedule validation", () => {
  const base = {
    regularPriceVnd: 50000,
    discountPriceVnd: "",
    discountStartsAt: "",
    discountEndsAt: "",
  };

  it("returns empty schedule fields when no discount is entered", () => {
    expect(buildDiscountSchedule(base)).toEqual({
      discountPriceVnd: null,
      discountStartsAt: null,
      discountEndsAt: null,
    });
  });

  it("returns RFC3339 schedule values with an explicit offset", () => {
    expect(
      buildDiscountSchedule({
        ...base,
        discountPriceVnd: "45000",
        discountStartsAt: "2026-11-03T00:00",
        discountEndsAt: "2026-11-10T00:00",
      }),
    ).toEqual({
      discountPriceVnd: 45000,
      discountStartsAt: "2026-11-03T00:00:00+07:00",
      discountEndsAt: "2026-11-10T00:00:00+07:00",
    });
  });

  it("requires a complete discount schedule", () => {
    expect(() => buildDiscountSchedule({ ...base, discountPriceVnd: "45000" })).toThrow(
      ProductDiscountError,
    );
    expect(() =>
      buildDiscountSchedule({
        ...base,
        discountStartsAt: "2026-11-03T00:00",
        discountEndsAt: "2026-11-10T00:00",
      }),
    ).toThrow(ProductDiscountError);
  });

  it("requires a positive discount below the regular price", () => {
    const schedule = {
      ...base,
      discountStartsAt: "2026-11-03T00:00",
      discountEndsAt: "2026-11-10T00:00",
    };
    expect(() => buildDiscountSchedule({ ...schedule, discountPriceVnd: "0" })).toThrow(
      ProductDiscountError,
    );
    expect(() => buildDiscountSchedule({ ...schedule, discountPriceVnd: "50000" })).toThrow(
      ProductDiscountError,
    );
  });

  it("requires the end time to be after the start time", () => {
    expect(() =>
      buildDiscountSchedule({
        ...base,
        discountPriceVnd: "45000",
        discountStartsAt: "2026-11-10T00:00",
        discountEndsAt: "2026-11-03T00:00",
      }),
    ).toThrow(ProductDiscountError);
  });

  it("rejects an unparsable discount time", () => {
    expect(() =>
      buildDiscountSchedule({
        ...base,
        discountPriceVnd: "45000",
        discountStartsAt: "not-a-date",
        discountEndsAt: "2026-11-10T00:00",
      }),
    ).toThrow(ProductDiscountError);
  });
});

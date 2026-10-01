import { describe, expect, it } from "vitest";
import { isOrderNumber, orderReference } from "./order-number.js";

describe("stored readable order references", () => {
  it("preserves long identity text without truncation or number conversion", () => {
    for (const value of ["BS-00000001", "BS-123456789", "BS-9223372036854775807"])
      expect(isOrderNumber(value)).toBe(true);
    for (const value of [
      null,
      1234,
      "BS-00000000",
      "BS-42",
      "<script>",
      "BS-00000001\n",
      "BS-12345678901234567890",
    ])
      expect(isOrderNumber(value)).toBe(false);
  });
  it("shows stored numbers and the complete legacy UUID", () => {
    const id = "fa000000-0000-0000-0000-000000000001";
    expect(orderReference({ orderId: id, orderNumber: "BS-00000001" })).toBe("BS-00000001");
    expect(orderReference({ orderId: id })).toBe(id);
  });
});

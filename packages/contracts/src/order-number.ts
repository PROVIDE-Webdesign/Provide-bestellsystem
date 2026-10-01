/** Stored database identity, rendered as text without lossy JavaScript number conversion. */
export function isOrderNumber(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    /^BS-[0-9]{8,19}$/.test(value) &&
    BigInt(value.slice(3)) > 0n &&
    BigInt(value.slice(3)) <= 9223372036854775807n
  );
}

/** Legacy responses use the complete UUID; a shortened suffix has no uniqueness guarantee. */
export function orderReference(order: { readonly orderId: string; readonly orderNumber?: string }) {
  return order.orderNumber ?? order.orderId;
}

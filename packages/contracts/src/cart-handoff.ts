import {
  menuIdPattern,
  parseOrderSelectionLines,
  type OrderSelectionLine,
} from "./menu-selection.js";
import { isExplicitInstant } from "./storefront.js";
import { record } from "./checkout-protection.js";
export interface CartHandoffSelection {
  readonly schemaVersion: 1;
  readonly menuId: string;
  readonly menuVersionId: string;
  readonly lines: readonly OrderSelectionLine[];
  readonly requestedFor?: string;
}
export const handoffIdPattern = /^[a-z0-9][a-z0-9-]{2,79}$/;
export const handoffTokenPattern = /^[a-f0-9]{64}$/;
export function parseCartHandoffSelection(value: unknown): CartHandoffSelection | undefined {
  const v = record(value);
  if (
    !v ||
    Object.keys(v).some(
      (k) => !["schemaVersion", "menuId", "menuVersionId", "lines", "requestedFor"].includes(k),
    ) ||
    v.schemaVersion !== 1 ||
    typeof v.menuId !== "string" ||
    !menuIdPattern.test(v.menuId) ||
    typeof v.menuVersionId !== "string" ||
    !menuIdPattern.test(v.menuVersionId) ||
    (v.requestedFor !== undefined &&
      (typeof v.requestedFor !== "string" || !isExplicitInstant(v.requestedFor)))
  )
    return;
  const lines = parseOrderSelectionLines(v.lines);
  if (!lines) return;
  return {
    schemaVersion: 1,
    menuId: v.menuId,
    menuVersionId: v.menuVersionId,
    lines,
    ...(typeof v.requestedFor === "string" ? { requestedFor: v.requestedFor } : {}),
  };
}

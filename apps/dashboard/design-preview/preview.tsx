import React from "react";
import { createRoot } from "react-dom/client";
import { DashboardClient } from "../app/components/DashboardClient";
import "../app/styles.css";
import "../app/operator-design.css";
const now = Date.parse("2026-11-05T18:00:00Z");
const NativeDate = Date;
window.Date = class extends NativeDate {
  constructor(value?: string | number | Date) {
    super(value === undefined ? now : value);
  }
  static now() {
    return now;
  }
} as DateConstructor;
const restaurantId = "f2000000-0000-0000-0000-000000000001";
const locationId = "f3000000-0000-0000-0000-000000000001";
const role = new URLSearchParams(window.location.search).get("role") ?? "owner";
const samples = [
  {
    number: 1042,
    name: "Nina M.",
    status: "submitted",
    time: "19:15",
    paid: false,
    age: 3,
    items: [
      [1, "Gyoza · Gemüse", 750],
      [1, "Crispy Duck", 1990],
    ],
  },
  {
    number: 1043,
    name: "Leon B.",
    status: "submitted",
    time: "19:30",
    paid: false,
    age: 1,
    items: [[2, "Veggie Bowl", 1290]],
  },
  {
    number: 1041,
    name: "Mila K.",
    status: "preparing",
    time: "19:10",
    paid: true,
    age: 8,
    items: [[2, "Chicken Teriyaki", 1390]],
  },
  {
    number: 1039,
    name: "Tom S.",
    status: "preparing",
    time: "19:20",
    paid: false,
    age: 12,
    items: [[1, "Miso Lachs", 2190]],
  },
  {
    number: 1040,
    name: "Ben L.",
    status: "ready",
    time: "19:00",
    paid: true,
    age: 10,
    items: [[1, "Crispy Duck", 1990]],
  },
];
const transitions = {
  submitted: ["accepted", "rejected", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed"],
  completed: [],
  rejected: [],
  cancelled: [],
};
let items = samples.map((sample) => ({
  orderId: `fa000000-0000-0000-0000-${String(sample.number).padStart(12, "0")}`,
  orderNumber: `BS-${String(sample.number).padStart(8, "0")}`,
  restaurantId,
  locationId,
  contactName: sample.name,
  status: sample.status,
  fulfillmentType: "pickup",
  paymentCollectionMode: sample.paid ? "online" : "on_fulfillment",
  paymentState: sample.paid ? "paid" : null,
  requestedFor: `2026-11-05T${sample.time}:00+01:00`,
  updatedAt: new NativeDate(now - sample.age * 60000).toISOString(),
  currency: "EUR",
  itemCount: sample.items.reduce((n, line) => n + Number(line[0]), 0),
  totalAmountMinor: sample.items.reduce((n, line) => n + Number(line[0]) * Number(line[2]), 0),
  allowedTransitions: transitions[sample.status],
  lines: sample.items.map((line, index) => ({
    lineNumber: index + 1,
    displayName: line[1],
    quantity: line[0],
    unitPriceAmountMinor: line[2],
    lineAmountMinor: Number(line[0]) * Number(line[2]),
  })),
}));
let operations = {
  timezone: "Europe/Berlin",
  serverNow: new NativeDate(now).toISOString(),
  publicationId: null,
  deliveryPolicyId: null,
  currentVersionId: "fb000000-0000-0000-0000-000000000001",
  operationSequence: 1,
  openOrders: 5,
  versions: [],
  overrides: [],
  audit: [],
};
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(),
    window.location.origin,
  );
  const ok = (data) => Response.json({ data });
  if (url.pathname === "/api/access-context")
    return ok({
      aal: "aal1",
      memberships: [
        {
          restaurantId,
          role,
          status: "active",
          access: "allowed",
          restaurant: { slug: "asian-kitchen", displayName: "Asian Kitchen" },
          locations: [{ id: locationId, slug: "mitte", displayName: "Mitte" }],
        },
      ],
    });
  if (url.pathname === "/api/operations") {
    if (init?.method === "POST") {
      const command = JSON.parse(String(init.body));
      operations = {
        ...operations,
        operationSequence: operations.operationSequence + 1,
        overrides:
          command.action === "clear_override"
            ? []
            : [
                {
                  scope: command.scope,
                  sequence: operations.operationSequence + 1,
                  endsAt: command.endsAt,
                  reason: command.reason,
                  values: command.values,
                },
              ],
      };
    }
    return ok(operations);
  }
  if (url.pathname === "/api/order-alerts")
    return ok({
      restaurantId,
      locationId,
      serverNow: new NativeDate(now).toISOString(),
      timeoutRule: "manual_review",
      totalPending: items.filter((item) => item.status === "submitted").length,
      orders: items
        .filter((item) => item.status === "submitted")
        .map((item) => ({
          orderId: item.orderId,
          orderNumber: item.orderNumber,
          fulfillmentType: "pickup",
          deadline: new NativeDate(now + 120000).toISOString(),
          escalatedAt: null,
        })),
    });
  if (url.pathname === "/api/orders")
    return ok({
      restaurantId,
      locationId,
      orders: items
        .filter(
          (item) =>
            !url.searchParams.get("status") || item.status === url.searchParams.get("status"),
        )
        .map(({ restaurantId, locationId, contactName, lines, ...summary }) => summary),
      nextCursor: null,
    });
  const match = /^\/api\/orders\/([^/]+)(\/status)?$/.exec(url.pathname);
  if (match) {
    const item = items.find((item) => item.orderId === match[1]);
    if (!item) return new Response("", { status: 404 });
    if (match[2]) {
      const command = JSON.parse(String(init?.body));
      if (command.expectedStatus !== item.status) return new Response("", { status: 409 });
      item.status = command.targetStatus;
      item.allowedTransitions = transitions[item.status];
      item.updatedAt = new NativeDate(now).toISOString();
      return ok({ orderId: item.orderId, status: item.status, updatedAt: item.updatedAt });
    }
    return ok(role === "viewer" ? { ...item, contactName: null } : item);
  }
  return Response.json({ error: { message: "Isolierte Gestaltungsprüfung" } }, { status: 503 });
};
createRoot(document.getElementById("root")!).render(
  <DashboardClient
    enabled
    menuEnabled
    historyEnabled
    personnelEnabled
    operationsEnabled
    alertsEnabled
  />,
);

const id = (n: number) => `fc000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const config = {
  schemaVersion: 1,
  informationConfirmed: true,
  taxRateBasisPoints: 700,
  allergens: [],
  additives: [],
  variants: [],
  optionGroups: [],
};
const dishes = [
  ["Chicken Teriyaki", "bowls", 1390],
  ["Veggie Bowl", "bowls", 1290],
  ["Salmon Bowl", "bowls", 1590],
  ["Gyoza", "sushi", 750],
];
const sections = [
  { key: "bowls", name: "Bowls" },
  { key: "sushi", name: "Sushi" },
  { key: "wok", name: "Wok" },
];
const items = dishes.map(([name, sectionKey, priceAmountMinor], index) => ({
  id: id(index + 1),
  name,
  sectionKey,
  priceAmountMinor,
  description: null,
  isActive: true,
  configuration: config,
}));
const menu = {
  timezone: "Europe/Berlin",
  stops: [
    {
      menuId: id(20),
      itemId: id(4),
      choiceId: null,
      blocked: true,
      endsAt: null,
      reason: "Heute ausverkauft",
    },
  ],
  menus: [
    {
      id: id(20),
      name: "Asian Kitchen",
      versions: [
        { id: id(22), number: 2, status: "draft", revision: 1, sections, items },
        {
          id: id(21),
          number: 1,
          status: "published",
          revision: 1,
          sections,
          items: items.map((item, i) => ({
            ...item,
            priceAmountMinor: item.priceAmountMinor - (i === 0 || i === 2 ? 100 : 0),
          })),
        },
      ],
      publications: [{ versionId: id(21), effectiveAt: "2026-11-01T10:00:00Z" }],
    },
  ],
};
const configuration = {
  minimumLeadMinutes: 15,
  maximumAdvanceDays: 14,
  slotIntervalMinutes: 15,
  defaultOrderCapacity: 10,
  defaultItemCapacity: 50,
  orderCutoffMinutes: 0,
  acceptanceMinutes: 5,
  maxOpenOrders: null,
  windows: Array.from({ length: 7 }, (_, weekday) => ({
    fulfillment: "pickup",
    weekday,
    opensAt: "12:00",
    closesAt: "22:00",
    orderCapacity: null,
    itemCapacity: null,
  })),
  exceptions: [],
  zones: [
    { postalCodes: ["52062"], minimumAmountMinor: 1500, feeAmountMinor: 250 },
    { postalCodes: ["52064"], minimumAmountMinor: 1500, feeAmountMinor: 350 },
  ],
};
const operations = {
  timezone: "Europe/Berlin",
  serverNow: "2026-11-05T18:00:00Z",
  publicationId: id(31),
  deliveryPolicyId: id(32),
  currentVersionId: id(30),
  operationSequence: 1,
  openOrders: 5,
  versions: [
    {
      id: id(33),
      number: 2,
      revision: 1,
      status: "draft",
      configuration: { ...configuration, defaultOrderCapacity: 12, maximumAdvanceDays: 10 },
    },
    { id: id(30), number: 1, revision: 1, status: "published", configuration },
  ],
  overrides: [],
  audit: [],
};
export async function managementFixture(url: URL, init?: RequestInit): Promise<Response | null> {
  if (!["/api/menu", "/api/operations"].includes(url.pathname)) return null;
  const ok = (data: unknown) => Response.json({ data });
  if (init?.method === "POST" && new URLSearchParams(location.search).has("fault"))
    return new Response("", { status: 409 });
  if (url.pathname === "/api/menu") {
    if (init?.method === "POST") {
      const c = JSON.parse(String(init.body));
      const m = menu.menus.find((m) => m.id === c.menuId) ?? menu.menus[0];
      const v = m.versions.find((v) => v.id === c.versionId);
      if (c.action === "save_draft" && v) {
        if (v.revision !== c.expectedRevision) return new Response("", { status: 409 });
        Object.assign(v, { sections: c.sections, items: c.items, revision: v.revision + 1 });
      } else if ((c.action === "publish" || c.action === "rollback") && v) {
        v.status = "published";
        m.publications.unshift({ versionId: v.id, effectiveAt: c.effectiveAt });
      } else if (c.action === "create_draft") {
        const source = m.versions.find((v) => v.id === c.sourceVersionId);
        m.versions.unshift({
          ...structuredClone(source ?? m.versions[0]),
          id: crypto.randomUUID(),
          status: "draft",
          number: m.versions.length + 1,
          revision: 1,
        });
      } else if (c.action === "stop") {
        menu.stops = menu.stops.filter((s) => s.itemId !== c.itemId || s.choiceId !== c.choiceId);
        menu.stops.push({ ...c });
      } else return new Response("", { status: 503 });
    }
    return ok(menu);
  }
  if (init?.method === "POST") {
    const c = JSON.parse(String(init.body));
    const v = operations.versions.find((v) => v.id === c.versionId);
    if (c.action === "create_draft") {
      const src = operations.versions.find((v) => v.id === c.sourceVersionId);
      operations.versions.unshift({
        id: crypto.randomUUID(),
        number: operations.versions.length + 1,
        revision: 1,
        status: "draft",
        configuration: structuredClone(src?.configuration ?? configuration),
      });
    } else if (c.action === "save_draft" && v) {
      if (v.revision !== c.expectedRevision) return new Response("", { status: 409 });
      Object.assign(v, { configuration: c.configuration, revision: v.revision + 1 });
    } else if (c.action === "publish" && v) {
      v.status = "published";
      operations.currentVersionId = v.id;
      operations.publicationId = crypto.randomUUID();
    } else {
      operations.operationSequence++;
      operations.overrides =
        c.action === "clear_override"
          ? []
          : [
              {
                scope: c.scope,
                sequence: operations.operationSequence,
                endsAt: c.endsAt,
                reason: c.reason,
                values: c.values,
              },
            ];
    }
  }
  return ok(operations);
}

import { menuIdPattern, parseMenuConfiguration, type MenuConfiguration } from "./menu-selection.js";
import { isExplicitInstant } from "./storefront.js";
export interface MenuDraftItem {
  readonly id: string;
  readonly sectionKey: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceAmountMinor: number;
  readonly isActive: boolean;
  readonly configuration: MenuConfiguration | null;
}
export interface MenuDraftSection {
  readonly key: string;
  readonly name: string;
}
export interface MenuAdminVersion {
  readonly id: string;
  readonly number: number;
  readonly status: "draft" | "published";
  readonly revision: number;
  readonly sections: readonly MenuDraftSection[];
  readonly items: readonly MenuDraftItem[];
}
export interface MenuAdminState {
  readonly timezone: string;
  readonly stops: readonly {
    readonly menuId: string;
    readonly itemId: string;
    readonly choiceId: string | null;
    readonly blocked: boolean;
    readonly endsAt: string | null;
    readonly reason: string;
  }[];
  readonly menus: readonly {
    readonly id: string;
    readonly name: string;
    readonly versions: readonly MenuAdminVersion[];
    readonly publications: readonly { readonly versionId: string; readonly effectiveAt: string }[];
  }[];
}
export type MenuAdminCommand =
  | { action: "create_menu"; name: string; slug: string }
  | { action: "create_draft"; menuId: string; sourceVersionId: string | null }
  | {
      action: "save_draft";
      menuId: string;
      versionId: string;
      expectedRevision: number;
      sections: readonly MenuDraftSection[];
      items: readonly MenuDraftItem[];
    }
  | {
      action: "publish" | "rollback";
      menuId: string;
      versionId: string;
      expectedRevision: number;
      effectiveAt: string;
      note: string;
    }
  | {
      action: "stop";
      menuId: string;
      versionId: string;
      itemId: string;
      choiceId: string | null;
      blocked: boolean;
      endsAt: string | null;
      reason: string;
    };
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const str = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const id = (v: unknown): v is string => typeof v === "string" && menuIdPattern.test(v);
const num = (v: unknown, max = 1_000_000_000): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
export function parseMenuDraft(
  v: unknown,
): { sections: readonly MenuDraftSection[]; items: readonly MenuDraftItem[] } | undefined {
  const s = obj(v);
  if (
    !s ||
    !Array.isArray(s.sections) ||
    !s.sections.length ||
    s.sections.length > 20 ||
    !Array.isArray(s.items) ||
    !s.items.length ||
    s.items.length > 200
  )
    return;
  const sections: MenuDraftSection[] = [];
  const items: MenuDraftItem[] = [];
  for (const value of s.sections) {
    const x = obj(value);
    if (!x || !str(x.key, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x.key) || !str(x.name, 100))
      return;
    sections.push({ key: x.key, name: x.name });
  }
  if (new Set(sections.map((x) => x.key)).size !== sections.length) return;
  for (const value of s.items) {
    const x = obj(value);
    if (
      !x ||
      !id(x.id) ||
      !str(x.sectionKey, 80) ||
      !sections.some((s) => s.key === x.sectionKey) ||
      !str(x.name, 300) ||
      (x.description !== null &&
        !(
          typeof x.description === "string" &&
          x.description.length <= 1000 &&
          !Array.from(x.description).some((c) => {
            const n = c.charCodeAt(0);
            return (n < 32 && ![9, 10, 13].includes(n)) || n === 127;
          })
        )) ||
      !num(x.priceAmountMinor) ||
      typeof x.isActive !== "boolean"
    )
      return;
    const configuration = x.configuration === null ? null : parseMenuConfiguration(x.configuration);
    if (configuration === undefined) return;
    items.push({
      id: x.id,
      sectionKey: x.sectionKey,
      name: x.name,
      description: x.description,
      priceAmountMinor: x.priceAmountMinor,
      isActive: x.isActive,
      configuration,
    });
  }
  if (new Set(items.map((x) => x.id.toLowerCase())).size !== items.length) return;
  return { sections, items };
}
export function parseMenuAdminCommand(v: unknown): MenuAdminCommand | undefined {
  const s = obj(v);
  if (!s || typeof s.action !== "string") return;
  const keys: Record<string, readonly string[]> = {
    create_menu: ["action", "name", "slug"],
    create_draft: ["action", "menuId", "sourceVersionId"],
    save_draft: ["action", "menuId", "versionId", "expectedRevision", "sections", "items"],
    publish: ["action", "menuId", "versionId", "expectedRevision", "effectiveAt", "note"],
    rollback: ["action", "menuId", "versionId", "expectedRevision", "effectiveAt", "note"],
    stop: ["action", "menuId", "versionId", "itemId", "choiceId", "blocked", "endsAt", "reason"],
  };
  const allowed = keys[s.action];
  if (
    !allowed ||
    Object.keys(s).length !== allowed.length ||
    Object.keys(s).some((k) => !allowed.includes(k))
  )
    return;
  if (s.action === "create_menu")
    return str(s.name, 100) &&
      str(s.slug, 63) &&
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug) &&
      s.slug.length >= 2
      ? { action: s.action, name: s.name, slug: s.slug }
      : undefined;
  if (!id(s.menuId)) return;
  if (s.action === "create_draft")
    return s.sourceVersionId === null || id(s.sourceVersionId)
      ? { action: s.action, menuId: s.menuId, sourceVersionId: s.sourceVersionId }
      : undefined;
  if (!id(s.versionId)) return;
  if (s.action === "stop")
    return id(s.itemId) &&
      (s.choiceId === null || id(s.choiceId)) &&
      typeof s.blocked === "boolean" &&
      (s.endsAt === null || (typeof s.endsAt === "string" && isExplicitInstant(s.endsAt))) &&
      str(s.reason, 200)
      ? {
          action: s.action,
          menuId: s.menuId,
          versionId: s.versionId,
          itemId: s.itemId,
          choiceId: s.choiceId,
          blocked: s.blocked,
          endsAt: s.endsAt,
          reason: s.reason,
        }
      : undefined;
  if (!num(s.expectedRevision)) return;
  if (s.action === "save_draft") {
    const draft = parseMenuDraft(s);
    return draft
      ? {
          action: s.action,
          menuId: s.menuId,
          versionId: s.versionId,
          expectedRevision: s.expectedRevision,
          ...draft,
        }
      : undefined;
  }
  return (s.action === "publish" || s.action === "rollback") &&
    typeof s.effectiveAt === "string" &&
    isExplicitInstant(s.effectiveAt) &&
    str(s.note, 200)
    ? {
        action: s.action,
        menuId: s.menuId,
        versionId: s.versionId,
        expectedRevision: s.expectedRevision,
        effectiveAt: s.effectiveAt,
        note: s.note,
      }
    : undefined;
}
export function parseMenuAdminState(v: unknown): MenuAdminState | undefined {
  const s = obj(v);
  if (
    !s ||
    typeof s.timezone !== "string" ||
    s.timezone.length > 80 ||
    !Array.isArray(s.stops) ||
    s.stops.length > 500 ||
    !Array.isArray(s.menus) ||
    s.menus.length > 20
  )
    return;
  try {
    new Intl.DateTimeFormat("en", { timeZone: s.timezone });
  } catch {
    return;
  }
  const stops: MenuAdminState["stops"][number][] = [];
  for (const value of s.stops) {
    const x = obj(value);
    if (
      !x ||
      !id(x.menuId) ||
      !id(x.itemId) ||
      (x.choiceId !== null && !id(x.choiceId)) ||
      typeof x.blocked !== "boolean" ||
      (x.endsAt !== null && (typeof x.endsAt !== "string" || !isExplicitInstant(x.endsAt))) ||
      !str(x.reason, 200)
    )
      return;
    stops.push({
      menuId: x.menuId,
      itemId: x.itemId,
      choiceId: x.choiceId,
      blocked: x.blocked,
      endsAt: x.endsAt,
      reason: x.reason,
    });
  }
  const menus: MenuAdminState["menus"][number][] = [];
  for (const value of s.menus) {
    const m = obj(value);
    if (
      !m ||
      !id(m.id) ||
      !str(m.name, 100) ||
      !Array.isArray(m.versions) ||
      m.versions.length > 50 ||
      !Array.isArray(m.publications) ||
      m.publications.length > 100
    )
      return;
    const versions: MenuAdminVersion[] = [];
    for (const value of m.versions) {
      const x = obj(value);
      if (
        !x ||
        !id(x.id) ||
        !num(x.number) ||
        !num(x.revision) ||
        (x.status !== "draft" && x.status !== "published")
      )
        return;
      const draft =
        Array.isArray(x.sections) &&
        x.sections.length === 0 &&
        Array.isArray(x.items) &&
        x.items.length === 0
          ? { sections: [], items: [] }
          : parseMenuDraft(x);
      if (!draft) return;
      versions.push({
        id: x.id,
        number: x.number,
        status: x.status,
        revision: x.revision,
        ...draft,
      });
    }
    const publications: MenuAdminState["menus"][number]["publications"][number][] = [];
    for (const value of m.publications) {
      const x = obj(value);
      if (
        !x ||
        !id(x.versionId) ||
        typeof x.effectiveAt !== "string" ||
        !isExplicitInstant(x.effectiveAt)
      )
        return;
      publications.push({ versionId: x.versionId, effectiveAt: x.effectiveAt });
    }
    menus.push({ id: m.id, name: m.name, versions, publications });
  }
  return { timezone: s.timezone, stops, menus };
}

import { parseMenuDraft, type MenuDraftItem, type MenuDraftSection } from "./menu-admin.js";
export interface MenuImportSource {
  readonly name: string;
  readonly sha256: string;
}
export interface MenuImportBundle {
  readonly format: "provide-menu-import-v1";
  readonly source: MenuImportSource;
  readonly sections: readonly MenuDraftSection[];
  readonly items: readonly MenuDraftItem[];
}
export function parseMenuImportSource(v: unknown): MenuImportSource | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return;
  const s = v as Record<string, unknown>;
  if (
    Object.keys(s).length !== 2 ||
    typeof s.name !== "string" ||
    !s.name.trim() ||
    s.name.length > 200 ||
    Array.from(s.name).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    typeof s.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(s.sha256)
  )
    return;
  return { name: s.name, sha256: s.sha256 };
}
/** A preview may contain missing declarations; import acceptance checks readiness separately. */
export function parseMenuImportBundle(v: unknown): MenuImportBundle | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return;
  const s = v as Record<string, unknown>;
  const source = parseMenuImportSource(s.source),
    draft = parseMenuDraft(s);
  if (s.format !== "provide-menu-import-v1" || !source || !draft) return;
  return { format: s.format, source, ...draft };
}
export const menuImportReady = (v: MenuImportBundle) =>
  v.items.every((i) => !i.isActive || i.configuration !== null);

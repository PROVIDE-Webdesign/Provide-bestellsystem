"use client";
import { useEffect, useState } from "react";
import {
  parseMenuAdminState,
  parseMenuAdminCommand,
  locationTimeToInstant,
  type MenuAdminState,
  type MenuAdminVersion,
  type MenuDraftItem,
  type MenuConfiguration,
  type MenuChoice,
  type MenuAdminCommand,
} from "@provide/contracts";
interface Location {
  readonly id: string;
  readonly displayName: string;
  readonly timezone?: string;
}
const emptyConfiguration = (): MenuConfiguration => ({
  schemaVersion: 1,
  informationConfirmed: true,
  taxRateBasisPoints: 0,
  allergens: [],
  additives: [],
  variants: [],
  optionGroups: [],
});
const move = <T,>(values: readonly T[], index: number, offset: number): readonly T[] => {
  const next = index + offset;
  if (next < 0 || next >= values.length) return values;
  const items = [...values];
  [items[index], items[next]] = [items[next]!, items[index]!];
  return items;
};
const choice = (): MenuChoice => ({
  id: crypto.randomUUID(),
  name: "Neue Auswahl",
  priceDeltaAmountMinor: 0,
  isActive: true,
});
export function MenuEditor({
  restaurantId,
  locations,
}: {
  restaurantId: string;
  locations: readonly Location[];
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const [locationId, setLocation] = useState(locations[0]?.id ?? "");
  const [state, setState] = useState<MenuAdminState | null>(null);
  const [menuId, setMenu] = useState("");
  const [versionId, setVersion] = useState("");
  const [draft, setDraft] = useState<MenuAdminVersion | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmedInfo, setConfirmedInfo] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [effective, setEffective] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [stopItem, setStopItem] = useState("");
  const [stopChoice, setStopChoice] = useState("");
  const [stopEnd, setStopEnd] = useState("");
  const [reason, setReason] = useState("");
  const menu = state?.menus.find((m) => m.id === menuId);
  const location = locations.find((l) => l.id === locationId);
  const timezone = state?.timezone;
  const selectVersion = (id: string, data = state) => {
    setVersion(id);
    setDraft(data?.menus.find((m) => m.id === menuId)?.versions.find((v) => v.id === id) ?? null);
    setConfirmedInfo(
      data?.menus
        .find((m) => m.id === menuId)
        ?.versions.find((v) => v.id === id)
        ?.items.filter((i) => i.configuration !== null)
        .map((i) => i.id) ?? [],
    );
    setDirty(false);
    setPreview(false);
  };
  const change = (next: MenuAdminVersion) => {
    setDraft(next);
    setDirty(true);
    setPreview(false);
  };
  async function request(command: MenuAdminCommand | null = null) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        "/api/menu?" + new URLSearchParams({ restaurantId, locationId }).toString(),
        {
          method: command ? "POST" : "GET",
          headers: command ? { "content-type": "application/json" } : {},
          ...(command ? { body: JSON.stringify(command) } : {}),
          cache: "no-store",
        },
      );
      if (response.status === 409) {
        setMessage(
          "Eine andere Bearbeitung war schneller. Lade den aktuellen Stand und übernimm deine Änderungen bewusst erneut.",
        );
        return;
      }
      if (!response.ok)
        throw Error(
          response.status === 400
            ? "Bitte prüfe Pflichtangaben, Auswahlgrenzen, Steuern und Veröffentlichung."
            : "Menüpflege ist gesperrt oder nicht verfügbar.",
        );
      const body = (await response.json()) as { data?: unknown };
      const data = parseMenuAdminState(body.data);
      if (!data) throw Error("Menüstand konnte nicht sicher gelesen werden.");
      setState(data);
      const chosen =
        (command?.action === "create_menu"
          ? data.menus.find((m) => !state?.menus.some((old) => old.id === m.id))
          : data.menus.find((m) => m.id === menuId)) ?? data.menus[0];
      setMenu(chosen?.id ?? "");
      const selected =
        command?.action === "create_draft" || command?.action === "create_menu"
          ? chosen?.versions[0]
          : (chosen?.versions.find((v) => v.id === versionId) ?? chosen?.versions[0]);
      setVersion(selected?.id ?? "");
      setDraft(selected ?? null);
      setConfirmedInfo(
        selected?.items.filter((i) => i.configuration !== null).map((i) => i.id) ?? [],
      );
      setDirty(false);
      setPreview(false);
      setMessage(
        command
          ? "Änderung gespeichert. Veröffentlichte Stände bleiben unverändert."
          : "Menüstand geladen.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Menüpflege ist gerade nicht verfügbar.");
    } finally {
      setBusy(false);
    }
  }
  const itemChange = (id: string, update: Partial<MenuDraftItem>) => {
    if (draft)
      change({ ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, ...update } : i)) });
  };
  const configChange = (item: MenuDraftItem, config: MenuConfiguration) => {
    setConfirmedInfo((ids) => ids.filter((id) => id !== item.id));
    itemChange(item.id, { configuration: config });
  };
  const baseline = menu?.versions.find(
    (v) => v.id === menu.publications.find((p) => Date.parse(p.effectiveAt) <= now)?.versionId,
  );
  const selectedStop = draft?.items.find((i) => i.id === stopItem);
  const stopChoices = selectedStop?.configuration
    ? [
        ...selectedStop.configuration.variants,
        ...selectedStop.configuration.optionGroups.flatMap((g) => g.options),
      ]
    : [];
  function submit(command: unknown) {
    if (
      command &&
      typeof command === "object" &&
      "action" in command &&
      ["save_draft", "publish"].includes(String(command.action)) &&
      draft?.items.some((i) => i.configuration !== null && !confirmedInfo.includes(i.id))
    ) {
      setMessage(
        "Bitte bestätige zuerst die geprüften Produktinformationen jedes geänderten Gerichts.",
      );
      return;
    }
    const parsed = parseMenuAdminCommand(command);
    if (!parsed) {
      setMessage("Bitte vervollständige Namen, Kategorien, Steuerangaben und Auswahlgrenzen.");
      return;
    }
    void request(parsed);
  }
  return (
    <section className="menu-editor" aria-labelledby={"menu-title-" + restaurantId}>
      <h3 id={"menu-title-" + restaurantId}>Speisekarte pflegen</h3>
      <fieldset disabled={busy}>
        <label>
          Standort
          <select
            value={locationId}
            onChange={(e) => {
              if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
              setLocation(e.target.value);
              setState(null);
              setDraft(null);
              setDirty(false);
            }}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            if (
              !dirty ||
              window.confirm("Aktuellen Stand laden und ungespeicherte Änderungen verwerfen?")
            )
              void request();
          }}
        >
          Menüstand laden
        </button>
        {state && (
          <>
            <fieldset>
              <legend>Neue Speisekarte</legend>
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </label>
              <label>
                Kurzname für die Speisekarte
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                />
              </label>
              <button type="button" onClick={() => submit({ action: "create_menu", name, slug })}>
                Speisekarte anlegen
              </button>
            </fieldset>
            <label>
              Speisekarte
              <select
                value={menuId}
                onChange={(e) => {
                  if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
                  const m = state.menus.find((m) => m.id === e.target.value);
                  setMenu(e.target.value);
                  setVersion(m?.versions[0]?.id ?? "");
                  setDraft(m?.versions[0] ?? null);
                  setConfirmedInfo(
                    m?.versions[0]?.items
                      .filter((i) => i.configuration !== null)
                      .map((i) => i.id) ?? [],
                  );
                  setDirty(false);
                  setPreview(false);
                }}
              >
                {state.menus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Version
              <select
                value={versionId}
                onChange={(e) => {
                  if (!dirty || window.confirm("Ungespeicherte Änderungen verwerfen?"))
                    selectVersion(e.target.value);
                }}
              >
                {menu?.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.number} – {v.status === "draft" ? "Entwurf" : "Veröffentlicht"}
                  </option>
                ))}
              </select>
            </label>
            {draft && (
              <>
                <p>
                  Version {draft.number}:{" "}
                  {draft.status === "draft"
                    ? "Entwurf, für Kunden unsichtbar"
                    : "Veröffentlicht, unveränderlich"}
                  {dirty ? " · Ungespeicherte Änderungen" : ""}
                </p>
                {draft.status === "published" && (
                  <button
                    type="button"
                    onClick={() =>
                      submit({ action: "create_draft", menuId, sourceVersionId: draft.id })
                    }
                  >
                    Als neuen Entwurf kopieren
                  </button>
                )}
                {draft.status === "draft" && (
                  <>
                    {draft.sections.map((section, index) => (
                      <div key={section.key}>
                        <label>
                          Kategorie
                          <input
                            value={section.name}
                            onChange={(e) =>
                              change({
                                ...draft,
                                sections: draft.sections.map((s) =>
                                  s.key === section.key ? { ...s, name: e.target.value } : s,
                                ),
                              })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          aria-label={`${section.name} nach oben`}
                          disabled={index === 0}
                          onClick={() =>
                            change({ ...draft, sections: move(draft.sections, index, -1) })
                          }
                        >
                          Nach oben
                        </button>
                        <button
                          type="button"
                          aria-label={`${section.name} nach unten`}
                          disabled={index === draft.sections.length - 1}
                          onClick={() =>
                            change({ ...draft, sections: move(draft.sections, index, 1) })
                          }
                        >
                          Nach unten
                        </button>
                        <button
                          type="button"
                          disabled={draft.items.some((i) => i.sectionKey === section.key)}
                          onClick={() =>
                            change({
                              ...draft,
                              sections: draft.sections.filter((s) => s.key !== section.key),
                            })
                          }
                        >
                          Leere Kategorie entfernen
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        change({
                          ...draft,
                          sections: [
                            ...draft.sections,
                            {
                              key: "category-" + crypto.randomUUID().slice(0, 8),
                              name: "Neue Kategorie",
                            },
                          ],
                        })
                      }
                    >
                      Kategorie hinzufügen
                    </button>
                    {draft.items.map((item, index) => (
                      <fieldset key={item.id}>
                        <legend>{item.name || "Gericht"}</legend>
                        <label>
                          Name
                          <input
                            value={item.name}
                            maxLength={300}
                            onChange={(e) => itemChange(item.id, { name: e.target.value })}
                          />
                        </label>
                        <label>
                          Beschreibung
                          <textarea
                            value={item.description ?? ""}
                            maxLength={1000}
                            onChange={(e) =>
                              itemChange(item.id, { description: e.target.value || null })
                            }
                          />
                        </label>
                        <label>
                          Kategorie
                          <select
                            value={item.sectionKey}
                            onChange={(e) => itemChange(item.id, { sectionKey: e.target.value })}
                          >
                            {draft.sections.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Preis in Euro
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.priceAmountMinor / 100}
                            onChange={(e) =>
                              itemChange(item.id, {
                                priceAmountMinor: Math.round(Number(e.target.value) * 100),
                              })
                            }
                          />
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={item.isActive}
                            onChange={(e) => itemChange(item.id, { isActive: e.target.checked })}
                          />
                          Gericht aktiv
                        </label>
                        {item.configuration === null ? (
                          <>
                            <p>
                              Produktinformationen noch unbekannt. Vor neuer Veröffentlichung
                              bestätigen.
                            </p>
                            <button
                              type="button"
                              onClick={() => configChange(item, emptyConfiguration())}
                            >
                              Produktinformationen ergänzen
                            </button>
                          </>
                        ) : (
                          <>
                            <ConfigurationEditor
                              key={draft.id + ":" + item.id + ":" + draft.revision}
                              value={item.configuration}
                              onChange={(v) => configChange(item, v)}
                            />
                            <label>
                              <input
                                type="checkbox"
                                checked={confirmedInfo.includes(item.id)}
                                onChange={(e) =>
                                  setConfirmedInfo((ids) =>
                                    e.target.checked
                                      ? [...ids, item.id]
                                      : ids.filter((id) => id !== item.id),
                                  )
                                }
                              />
                              Ich habe Steuersatz, Allergene, Zusatzstoffe und Auswahl dieses
                              Gerichts geprüft.
                            </label>
                          </>
                        )}
                        <button
                          type="button"
                          aria-label={`${item.name} nach oben`}
                          disabled={index === 0}
                          onClick={() => change({ ...draft, items: move(draft.items, index, -1) })}
                        >
                          Nach oben
                        </button>
                        <button
                          type="button"
                          aria-label={`${item.name} nach unten`}
                          disabled={index === draft.items.length - 1}
                          onClick={() => change({ ...draft, items: move(draft.items, index, 1) })}
                        >
                          Nach unten
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            change({ ...draft, items: draft.items.filter((i) => i.id !== item.id) })
                          }
                        >
                          Aus diesem Entwurf entfernen
                        </button>
                      </fieldset>
                    ))}
                    <button
                      type="button"
                      disabled={!draft.sections.length || draft.items.length >= 200}
                      onClick={() =>
                        change({
                          ...draft,
                          items: [
                            ...draft.items,
                            {
                              id: crypto.randomUUID(),
                              sectionKey: draft.sections[0]!.key,
                              name: "Neues Gericht",
                              description: null,
                              priceAmountMinor: 0,
                              isActive: true,
                              configuration: null,
                            },
                          ],
                        })
                      }
                    >
                      Gericht hinzufügen
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        submit({
                          action: "save_draft",
                          menuId,
                          versionId: draft.id,
                          expectedRevision: draft.revision,
                          sections: draft.sections,
                          items: draft.items,
                        })
                      }
                    >
                      Entwurf speichern
                    </button>
                  </>
                )}
                <button type="button" onClick={() => setPreview(!preview)}>
                  Änderungsvorschau {preview ? "schließen" : "anzeigen"}
                </button>
                {preview && (
                  <div aria-label="Menüvorschau">
                    <h4>Änderungen gegenüber dem aktiven Stand</h4>
                    <ul>
                      {draft.items.map((i) => {
                        const old = baseline?.items.find((o) => o.id === i.id);
                        return (
                          <li key={i.id}>
                            {i.name}:{" "}
                            {old
                              ? `${old.name}, ${(old.priceAmountMinor / 100).toFixed(2)} EUR → ${(i.priceAmountMinor / 100).toFixed(2)} EUR`
                              : "Neu"}
                            ;{" "}
                            {old &&
                            JSON.stringify(old.configuration) !== JSON.stringify(i.configuration)
                              ? "Produktinformationen/Auswahl geändert"
                              : ""}
                          </li>
                        );
                      })}
                      {baseline?.items
                        .filter((i) => !draft.items.some((d) => d.id === i.id))
                        .map((i) => (
                          <li key={i.id}>Entfernt: {i.name}</li>
                        ))}
                    </ul>
                    {draft.sections.map((s) => (
                      <section key={s.key}>
                        <h4>{s.name}</h4>
                        <ul>
                          {draft.items
                            .filter((i) => i.sectionKey === s.key && i.isActive)
                            .map((i) => (
                              <li key={i.id}>
                                {i.name} – {(i.priceAmountMinor / 100).toFixed(2)} EUR; Varianten:{" "}
                                {i.configuration?.variants.map((v) => v.name).join(", ") || "keine"}
                                ; Allergene: {i.configuration?.allergens.join(", ") ?? "unbekannt"}
                              </li>
                            ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
                <fieldset>
                  <legend>
                    {draft.status === "draft"
                      ? "Bewusst veröffentlichen"
                      : "Auf diese Version zurückkehren"}
                  </legend>
                  <p>
                    Standort: {location?.displayName}. Zeitangaben gelten in {timezone}. Leeres
                    Datum bedeutet sofort.
                  </p>
                  <label>
                    Geplante Aktivierung
                    <input
                      type="datetime-local"
                      value={effective}
                      onChange={(e) => setEffective(e.target.value)}
                    />
                  </label>
                  <label>
                    Änderungsnotiz
                    <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    disabled={dirty || !preview}
                    onClick={() => {
                      const effectiveAt = effective
                        ? timezone
                          ? locationTimeToInstant(effective, timezone)
                          : undefined
                        : new Date().toISOString();
                      if (!timezone || !effectiveAt) {
                        setMessage("Bitte wähle einen eindeutigen Zeitpunkt.");
                        return;
                      }
                      if (
                        window.confirm(
                          "Diese Version nach geprüfter Vorschau für den ausgewählten Standort aktivieren?",
                        )
                      )
                        submit({
                          action: draft.status === "draft" ? "publish" : "rollback",
                          menuId,
                          versionId: draft.id,
                          expectedRevision: draft.revision,
                          effectiveAt,
                          note,
                        });
                    }}
                  >
                    Nach Vorschau {draft.status === "draft" ? "veröffentlichen" : "zurückkehren"}
                  </button>
                </fieldset>
                <ul aria-label="Veröffentlichungsverlauf">
                  {menu?.publications.map((p, i) => (
                    <li key={p.versionId + p.effectiveAt + i}>
                      Version{" "}
                      {menu.versions.find((v) => v.id === p.versionId)?.number ?? "älterer Stand"} ·{" "}
                      {new Intl.DateTimeFormat("de-DE", {
                        dateStyle: "short",
                        timeStyle: "short",
                        ...(timezone ? { timeZone: timezone } : {}),
                      }).format(new Date(p.effectiveAt))}
                    </li>
                  ))}
                </ul>
                <fieldset>
                  <legend>Ausverkauft steuern</legend>
                  <ul aria-label="Aktuelle Verfügbarkeit">
                    {state.stops
                      .filter((s) => s.menuId === menuId)
                      .map((s) => (
                        <li key={s.itemId + (s.choiceId ?? "")}>
                          {draft.items.find((i) => i.id === s.itemId)?.name ??
                            "Gericht aus anderer Version"}{" "}
                          ·{" "}
                          {s.choiceId
                            ? (draft.items
                                .flatMap((i) => [
                                  ...(i.configuration?.variants ?? []),
                                  ...(i.configuration?.optionGroups.flatMap((g) => g.options) ??
                                    []),
                                ])
                                .find((c) => c.id === s.choiceId)?.name ?? "Auswahl")
                            : "Ganzes Gericht"}
                          :{" "}
                          {s.blocked && (!s.endsAt || Date.parse(s.endsAt) > now)
                            ? "Ausverkauft"
                            : "Verfügbar"}
                          {s.endsAt
                            ? ` · Bis ${new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(s.endsAt))}`
                            : ""}{" "}
                          {s.blocked && s.endsAt && Date.parse(s.endsAt) > now
                            ? ` · Noch ${Math.ceil((Date.parse(s.endsAt) - now) / 60000)} Minuten`
                            : ""}
                          · {s.reason}
                        </li>
                      ))}
                  </ul>
                  <label>
                    Gericht
                    <select
                      value={stopItem}
                      onChange={(e) => {
                        setStopItem(e.target.value);
                        setStopChoice("");
                      }}
                    >
                      <option value="">Bitte wählen</option>
                      {draft.items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Umfang
                    <select value={stopChoice} onChange={(e) => setStopChoice(e.target.value)}>
                      <option value="">Ganzes Gericht</option>
                      {stopChoices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ausverkauft bis (leer: bis Wiederfreigabe)
                    <input
                      type="datetime-local"
                      value={stopEnd}
                      onChange={(e) => setStopEnd(e.target.value)}
                    />
                  </label>
                  <label>
                    Grund
                    <input
                      value={reason}
                      maxLength={200}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  {[true, false].map((blocked) => (
                    <button
                      key={String(blocked)}
                      type="button"
                      onClick={() => {
                        const endsAt = stopEnd
                          ? timezone
                            ? locationTimeToInstant(stopEnd, timezone)
                            : undefined
                          : null;
                        if (!timezone || (stopEnd && !endsAt)) {
                          setMessage("Ungültiges Ablaufdatum.");
                          return;
                        }
                        submit({
                          action: "stop",
                          menuId,
                          versionId: draft.id,
                          itemId: stopItem,
                          choiceId: stopChoice || null,
                          blocked,
                          endsAt,
                          reason,
                        });
                      }}
                    >
                      {blocked ? "Als ausverkauft markieren" : "Wieder freigeben"}
                    </button>
                  ))}
                </fieldset>
              </>
            )}
          </>
        )}
      </fieldset>
      <p role="status" aria-live="polite">
        {busy ? "Menü wird sicher verarbeitet …" : message}
      </p>
    </section>
  );
}
function ConfigurationEditor({
  value,
  onChange,
}: {
  value: MenuConfiguration;
  onChange: (v: MenuConfiguration) => void;
}) {
  const [allergenText, setAllergenText] = useState(value.allergens.join(", "));
  const [additiveText, setAdditiveText] = useState(value.additives.join(", "));
  const updateChoice = (list: readonly MenuChoice[], id: string, part: Partial<MenuChoice>) =>
    list.map((c) => (c.id === id ? { ...c, ...part } : c));
  const controls = (c: MenuChoice, update: (p: Partial<MenuChoice>) => void) => (
    <div key={c.id}>
      <label>
        Bezeichnung
        <input value={c.name} maxLength={100} onChange={(e) => update({ name: e.target.value })} />
      </label>
      <label>
        Aufpreis in Euro
        <input
          type="number"
          min="0"
          step="0.01"
          value={c.priceDeltaAmountMinor / 100}
          onChange={(e) =>
            update({ priceDeltaAmountMinor: Math.round(Number(e.target.value) * 100) })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={c.isActive}
          onChange={(e) => update({ isActive: e.target.checked })}
        />
        Verfügbar
      </label>
    </div>
  );
  return (
    <fieldset>
      <legend>Produktinformationen und Auswahl</legend>
      <label>
        Bestätigter Steuersatz in Prozent
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={value.taxRateBasisPoints / 100}
          onChange={(e) =>
            onChange({ ...value, taxRateBasisPoints: Math.round(Number(e.target.value) * 100) })
          }
        />
      </label>
      <label>
        Allergene, durch Komma getrennt
        <input
          value={allergenText}
          onChange={(e) => {
            setAllergenText(e.target.value);
            onChange({
              ...value,
              allergens: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        />
      </label>
      <label>
        Zusatzstoffe, durch Komma getrennt
        <input
          value={additiveText}
          onChange={(e) => {
            setAdditiveText(e.target.value);
            onChange({
              ...value,
              additives: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        />
      </label>
      <p>
        Veröffentlichung bestätigt diese Angaben. Leere Listen bedeuten bewusst „keine deklariert“.
      </p>
      <fieldset>
        <legend>Varianten (genau eine Auswahl, wenn vorhanden)</legend>
        {value.variants.map((c) =>
          controls(c, (p) =>
            onChange({ ...value, variants: updateChoice(value.variants, c.id, p) }),
          ),
        )}
        <button
          type="button"
          onClick={() => onChange({ ...value, variants: [...value.variants, choice()] })}
        >
          Variante hinzufügen
        </button>
      </fieldset>
      {value.optionGroups.map((g) => (
        <fieldset key={g.id}>
          <legend>Extra-Gruppe</legend>
          <label>
            Name
            <input
              value={g.name}
              onChange={(e) =>
                onChange({
                  ...value,
                  optionGroups: value.optionGroups.map((x) =>
                    x.id === g.id ? { ...g, name: e.target.value } : x,
                  ),
                })
              }
            />
          </label>
          {(["minSelections", "maxSelections"] as const).map((k) => (
            <label key={k}>
              {k === "minSelections" ? "Mindestens" : "Höchstens"}
              <input
                type="number"
                min="0"
                max="50"
                value={g[k]}
                onChange={(e) =>
                  onChange({
                    ...value,
                    optionGroups: value.optionGroups.map((x) =>
                      x.id === g.id ? { ...g, [k]: Number(e.target.value) } : x,
                    ),
                  })
                }
              />
            </label>
          ))}
          {g.options.map((c) =>
            controls(c, (p) =>
              onChange({
                ...value,
                optionGroups: value.optionGroups.map((x) =>
                  x.id === g.id ? { ...g, options: updateChoice(g.options, c.id, p) } : x,
                ),
              }),
            ),
          )}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                optionGroups: value.optionGroups.map((x) =>
                  x.id === g.id ? { ...g, options: [...g.options, choice()] } : x,
                ),
              })
            }
          >
            Extra hinzufügen
          </button>
          <button
            type="button"
            onClick={() =>
              onChange({ ...value, optionGroups: value.optionGroups.filter((x) => x.id !== g.id) })
            }
          >
            Gruppe entfernen
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            optionGroups: [
              ...value.optionGroups,
              {
                id: crypto.randomUUID(),
                name: "Neue Extras",
                minSelections: 0,
                maxSelections: 1,
                options: [choice()],
              },
            ],
          })
        }
      >
        Extra-Gruppe hinzufügen
      </button>
    </fieldset>
  );
}

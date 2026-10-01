"use client";
import { useState } from "react";
import { parseMenuImportBundle, menuImportReady, type MenuImportBundle } from "@provide/contracts";
export function MenuImport({
  disabled,
  onImport,
}: {
  disabled: boolean;
  onImport: (bundle: MenuImportBundle) => void;
}) {
  const [bundle, setBundle] = useState<MenuImportBundle | null>(null),
    [message, setMessage] = useState("");
  async function load(file: File | undefined) {
    setBundle(null);
    setMessage("");
    if (!file) return;
    if (file.size > 512 * 1024) {
      setMessage("Die Importdatei darf höchstens 512 KiB groß sein.");
      return;
    }
    try {
      const parsed = parseMenuImportBundle(JSON.parse(await file.text()));
      if (!parsed) throw Error();
      setBundle(parsed);
      setMessage(
        menuImportReady(parsed)
          ? "Import geprüft. Als neuer Entwurf übernehmen; danach Vorschau und Veröffentlichung prüfen."
          : "Import gesperrt: bestätigte Steuer-, Allergen-, Zusatzstoff- und Auswahlkonfigurationen fehlen. Die Quelldatei bleibt unverändert.",
      );
    } catch {
      setMessage("Die Datei entspricht nicht dem geprüften Menüimportformat.");
    }
  }
  return (
    <fieldset aria-label="Menüimport">
      <legend>Menüdatei prüfen und importieren</legend>
      <label>
        Importdatei (JSON)
        <input
          type="file"
          accept=".json,application/json"
          disabled={disabled}
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </label>
      {bundle && (
        <>
          <p>
            {bundle.source.name} · {bundle.items.length} Gerichte · {bundle.sections.length}{" "}
            Kategorien
          </p>
          <ul>
            {bundle.items.map((i) => (
              <li key={i.id}>
                {i.name} · ab{" "}
                {(i.priceAmountMinor / 100).toLocaleString("de-DE", {
                  style: "currency",
                  currency: "EUR",
                })}{" "}
                · {i.configuration ? "Deklaration bestätigt" : "Deklaration fehlt"}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={disabled || !menuImportReady(bundle)}
            onClick={() => {
              if (
                window.confirm("Geprüfte Datei als neuen, unveröffentlichten Entwurf importieren?")
              )
                onImport({
                  ...bundle,
                  items: bundle.items.map((i) => ({ ...i, id: crypto.randomUUID() })),
                });
            }}
          >
            Als neuen Entwurf importieren
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </fieldset>
  );
}

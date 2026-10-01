"use client";
import { useState } from "react";
import type { PublicCatalog, OrderSelectionLine } from "@provide/contracts";
type Item = PublicCatalog["menus"][number]["sections"][number]["items"][number];
export function ItemPicker({
  item,
  currency,
  onAdd,
}: {
  item: Item;
  currency: string;
  onAdd: (selection: Pick<OrderSelectionLine, "variantId" | "optionIds">) => void;
}) {
  const config = item.configuration;
  const [variantId, setVariant] = useState("");
  const [optionIds, setOptions] = useState<readonly string[]>([]);
  const [error, setError] = useState("");
  const money = (n: number) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(n / 100);
  const selectedVariant = config?.variants.find((v) => v.id === variantId && v.isActive);
  const valid =
    !config ||
    ((config.variants.length === 0 || !!selectedVariant) &&
      config.optionGroups.every((g) => {
        const count = g.options.filter((o) => o.isActive && optionIds.includes(o.id)).length;
        return count >= g.minSelections && count <= g.maxSelections;
      }));
  const delta =
    (selectedVariant?.priceDeltaAmountMinor ?? 0) +
    (config?.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => o.isActive && optionIds.includes(o.id))
      .reduce((n, o) => n + o.priceDeltaAmountMinor, 0) ?? 0);
  return (
    <div className="dish-action">
      {config ? (
        <div className="product-information">
          <p>Allergene: {config.allergens.join(", ") || "Keine deklariert"}</p>
          <p>Zusatzstoffe: {config.additives.join(", ") || "Keine deklariert"}</p>
        </div>
      ) : (
        <p className="fine-print">Allergeninformationen noch nicht hinterlegt.</p>
      )}
      {config && config.variants.length > 0 && (
        <label>
          Variante
          <select
            value={variantId}
            onChange={(e) => {
              setVariant(e.target.value);
              setError("");
            }}
          >
            <option value="">Bitte wählen</option>
            {config.variants.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.isActive}>
                {v.name} (+{money(v.priceDeltaAmountMinor)})
                {v.isActive ? "" : " – derzeit nicht verfügbar"}
              </option>
            ))}
          </select>
        </label>
      )}
      {config?.optionGroups.map((g) => (
        <fieldset key={g.id}>
          <legend>
            {g.name} – {g.minSelections} bis {g.maxSelections} auswählen
          </legend>
          {g.options.map((o) => (
            <label key={o.id}>
              <input
                type="checkbox"
                checked={optionIds.includes(o.id)}
                disabled={!o.isActive}
                onChange={(e) => {
                  setOptions(
                    e.target.checked ? [...optionIds, o.id] : optionIds.filter((id) => id !== o.id),
                  );
                  setError("");
                }}
              />
              {o.name} (+{money(o.priceDeltaAmountMinor)})
              {o.isActive ? "" : " – derzeit nicht verfügbar"}
            </label>
          ))}
        </fieldset>
      ))}
      <span className="price">{money(item.priceAmountMinor + delta)}</span>
      <button
        type="button"
        className="add-button"
        disabled={item.availability !== "available"}
        onClick={() => {
          if (!valid) {
            setError("Bitte vervollständige die Variante und die Anzahl der Extras.");
            return;
          }
          onAdd(config ? { ...(variantId ? { variantId } : {}), optionIds } : {});
        }}
      >
        Hinzufügen
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

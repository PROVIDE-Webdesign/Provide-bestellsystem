import type { TaxSummary } from "@provide/contracts";
export function OrderTax({
  summary,
  currency,
}: {
  summary: TaxSummary | null | undefined;
  currency: string;
}) {
  const money = (n: number) => (n / 100).toLocaleString("de-DE", { style: "currency", currency });
  if (!summary) return <p>Historische Steueraufteilung nicht deklariert.</p>;
  return (
    <details>
      <summary>Steueraufteilung</summary>
      <p>
        Artikel: {money(summary.subtotalAmountMinor)} · Rabatt: {money(summary.discountAmountMinor)}{" "}
        · Lieferung: {money(summary.deliveryFeeAmountMinor)}
      </p>
      {summary.buckets.map((b) => (
        <p key={b.taxRateBasisPoints}>
          {b.taxRateBasisPoints / 100} %: Brutto {money(b.grossAmountMinor)}, Netto{" "}
          {money(b.netAmountMinor)}, Steuer {money(b.taxAmountMinor)}
        </p>
      ))}
      <p>
        Steuersumme: {money(summary.taxAmountMinor)} ·{" "}
        {summary.status === "complete" ? "Netto" : "Netto bestätigter Anteile"}:{" "}
        {money(summary.knownNetAmountMinor)}
      </p>
      {summary.status === "partial" && (
        <p>Noch nicht deklarierter Bruttobetrag: {money(summary.undeclaredGrossAmountMinor)}</p>
      )}
    </details>
  );
}

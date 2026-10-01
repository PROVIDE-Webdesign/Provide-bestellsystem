import type { TaxSummary } from "@provide/contracts";
export function TaxBreakdown({
  summary,
  currency = "EUR",
}: {
  summary: TaxSummary | null | undefined;
  currency?: string;
}) {
  if (!summary) return null;
  const money = (n: number) => (n / 100).toLocaleString("de-DE", { style: "currency", currency });
  return (
    <details>
      <summary>Enthaltene Steuern und Summen</summary>
      <p>
        Artikel: {money(summary.subtotalAmountMinor)} · Rabatt: {money(summary.discountAmountMinor)}{" "}
        · Lieferung: {money(summary.deliveryFeeAmountMinor)}
      </p>
      {summary.buckets.map((b) => (
        <p key={b.taxRateBasisPoints}>
          Enthaltene Steuer {b.taxRateBasisPoints / 100} %: {money(b.taxAmountMinor)} · Netto:{" "}
          {money(b.netAmountMinor)}
        </p>
      ))}
      {summary.status === "partial" && (
        <p>Steuerangaben für {money(summary.undeclaredGrossAmountMinor)} noch nicht deklariert.</p>
      )}
      <p>
        Gesamt: {money(summary.totalAmountMinor)} ·{" "}
        {summary.status === "complete" ? "Netto" : "Netto bestätigter Anteile"}:{" "}
        {money(summary.knownNetAmountMinor)}
      </p>
    </details>
  );
}

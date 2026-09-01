# 0002 - Monorepo-Grenzen

- Status: bestätigt
- Datum: 2026-09-01

## Entscheidung

Storefront, Dashboard, API und geteilte Pakete werden in einem pnpm-/Turborepo-Monorepo entwickelt.
Die Asian-Kitchen-Marketingwebsite bleibt außerhalb dieses Repositorys eine eigene SoT.

## Konsequenzen

- Kundenseite und Dashboard dürfen fachliche Verträge teilen, aber keine Secrets oder privilegierte
  Serverlogik.
- Anbieterabhängige Typen bleiben hinter Adaptern.
- Produktionsbindungen werden erst nach den vorgesehenen Technik-Spikes ergänzt.

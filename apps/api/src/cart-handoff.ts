import { Client } from "pg";
import {
  verifyCheckoutRequest,
  readCheckoutBody,
  record,
  onlyKeys,
  parseCartHandoffSelection,
  handoffIdPattern,
  handoffTokenPattern,
  checkoutDigest,
  parsePublicCatalog,
} from "@provide/contracts";
import { postgresStorefrontReader } from "./storefront-database.js";
interface Env {
  CHECKOUT_GATEWAY_SECRET?: string;
  CHECKOUT_STOREFRONT_ORIGIN?: string;
  HYPERDRIVE?: { connectionString: string };
  HYPERDRIVE_CACHE_DISABLED?: string;
}
export async function handleCartHandoff(request: Request, env: Env): Promise<Response> {
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  const fail = (status: number, code: string) =>
    Response.json({ error: { code } }, { status, headers });
  if (request.method !== "POST") return fail(405, "bad_request");
  if (!env.HYPERDRIVE || env.HYPERDRIVE_CACHE_DISABLED !== "true")
    return fail(503, "service_unavailable");
  let client: Client | undefined;
  try {
    const text = await readCheckoutBody(request);
    const a = await verifyCheckoutRequest(request, text, [env.CHECKOUT_GATEWAY_SECRET]);
    if (!a) return fail(403, "forbidden");
    const v = record(JSON.parse(text));
    if (
      !v ||
      !onlyKeys(
        v,
        v.action === "redeem"
          ? ["action", "integrationId", "token", "restaurantSlug", "locationSlug"]
          : v.action === "create"
            ? ["action", "integrationId", "sourceOrigin", "selection"]
            : ["action", "integrationId", "sourceOrigin"],
      ) ||
      typeof v.integrationId !== "string" ||
      !handoffIdPattern.test(v.integrationId) ||
      !["catalog", "create", "redeem"].includes(String(v.action))
    )
      return fail(400, "bad_request");
    client = new Client({
      connectionString: env.HYPERDRIVE.connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 9000,
    });
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query("SET LOCAL statement_timeout='8s'");
    // Serialize bounded accounting and one-use claims independently from order/payment tables.
    await client.query("SELECT pg_advisory_xact_lock(18651,1)");
    await client.query(
      "DELETE FROM private.cart_handoff_budget WHERE key IN (SELECT key FROM private.cart_handoff_budget WHERE expires_at<now() LIMIT 200)",
    );
    await client.query(
      "DELETE FROM private.cart_handoff_drafts WHERE token_hash IN (SELECT token_hash FROM private.cart_handoff_drafts WHERE expires_at<now() LIMIT 200)",
    );
    const budget = await client.query<{ uses: number }>(
      "INSERT INTO private.cart_handoff_budget(key,uses,expires_at) VALUES ($1,1,now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET uses=private.cart_handoff_budget.uses+1 RETURNING uses",
      ["network:" + a.network[0]],
    );
    if (Number(budget.rows[0]?.uses) > 120) {
      await client.query("COMMIT");
      return fail(429, "rate_limited");
    }
    const nonce = await client.query(
      "INSERT INTO private.cart_handoff_budget(key,uses,expires_at) VALUES ($1,1,now()+interval '1 minute') ON CONFLICT DO NOTHING RETURNING key",
      ["nonce:" + a.nonce],
    );
    if (!nonce.rowCount) {
      await client.query("COMMIT");
      return fail(403, "forbidden");
    }
    const cfg = await client.query<{
      restaurant_slug: string;
      location_slug: string;
      source_origin: string;
    }>(
      "SELECT restaurant_slug,location_slug,source_origin FROM private.cart_handoff_integrations WHERE id=$1 AND enabled AND expires_at>now()",
      [v.integrationId],
    );
    const i = cfg.rows[0];
    if (!i) {
      await client.query("COMMIT");
      return fail(404, "not_found");
    }
    const scope = {
      restaurantSlug: String(i.restaurant_slug),
      locationSlug: String(i.location_slug),
    };
    if (v.action !== "redeem" && v.sourceOrigin !== i.source_origin) {
      await client.query("COMMIT");
      return fail(403, "forbidden");
    }
    if (v.action === "redeem") {
      if (
        !a.context ||
        !handoffTokenPattern.test(String(v.token)) ||
        v.restaurantSlug !== scope.restaurantSlug ||
        v.locationSlug !== scope.locationSlug
      ) {
        await client.query("COMMIT");
        return fail(403, "forbidden");
      }
      const claim = await client.query<{ selection: unknown; expires_at: Date }>(
        "UPDATE private.cart_handoff_drafts SET redeemed_by=coalesce(redeemed_by,$2) WHERE token_hash=$1 AND integration_id=$3 AND expires_at>now() AND (redeemed_by IS NULL OR redeemed_by=$2) RETURNING selection,expires_at",
        [await checkoutDigest(String(v.token)), a.context, v.integrationId],
      );
      await client.query("COMMIT");
      if (!claim.rowCount) return fail(410, "handoff_expired");
      return Response.json(
        {
          data: {
            selection: claim.rows[0]!.selection,
            expiresAt: claim.rows[0]!.expires_at,
            scope,
          },
        },
        { headers },
      );
    }
    if (v.action === "catalog") {
      await client.query("COMMIT");
      const raw = await postgresStorefrontReader.catalog(env.HYPERDRIVE.connectionString, scope);
      const catalog = parsePublicCatalog(raw);
      if (!catalog) return fail(503, "service_unavailable");
      return Response.json({ data: { catalog, scope } }, { headers });
    }
    const selection = parseCartHandoffSelection(v.selection);
    if (!selection) {
      await client.query("COMMIT");
      return fail(400, "bad_request");
    }
    const current = parsePublicCatalog(
      await postgresStorefrontReader.catalog(env.HYPERDRIVE.connectionString, scope),
    );
    const menu = current?.menus.find(
      (m) => m.id === selection.menuId && m.versionId === selection.menuVersionId,
    );
    if (
      !menu ||
      selection.lines.some((l) => {
        const item = menu.sections.flatMap((s) => s.items).find((i) => i.id === l.menuItemId);
        if (!item || item.availability !== "available") return true;
        const c = item.configuration,
          opts = l.optionIds ?? [];
        if (!c) return !!l.variantId || opts.length > 0;
        if (c.variants.length > 0 && !c.variants.some((v) => v.isActive && v.id === l.variantId))
          return true;
        if (l.variantId && !c.variants.some((v) => v.isActive && v.id === l.variantId)) return true;
        return (
          opts.some(
            (id) => !c.optionGroups.some((g) => g.options.some((o) => o.isActive && o.id === id)),
          ) ||
          c.optionGroups.some((g) => {
            const n = g.options.filter((o) => o.isActive && opts.includes(o.id)).length;
            return n < g.minSelections || n > g.maxSelections;
          })
        );
      })
    ) {
      await client.query("COMMIT");
      return fail(409, "selection_changed");
    }
    const count = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM private.cart_handoff_drafts WHERE integration_id=$1 AND expires_at>now()",
      [v.integrationId],
    );
    if (Number(count.rows[0]!.n) >= 500) {
      await client.query("COMMIT");
      return fail(429, "rate_limited");
    }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const inserted = await client.query<{ expires_at: Date }>(
      "INSERT INTO private.cart_handoff_drafts(token_hash,integration_id,selection,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes') RETURNING expires_at",
      [await checkoutDigest(token), v.integrationId, JSON.stringify(selection)],
    );
    await client.query("COMMIT");
    const target = new URL(
      "/r/" + scope.restaurantSlug + "/" + scope.locationSlug,
      env.CHECKOUT_STOREFRONT_ORIGIN,
    );
    target.hash = "cart-import=" + v.integrationId + "." + token;
    return Response.json(
      { data: { url: target.href, expiresAt: inserted.rows[0]!.expires_at } },
      { headers },
    );
  } catch {
    return fail(503, "service_unavailable");
  } finally {
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  }
}

export async function cleanupCartHandoffs(env: Env): Promise<void> {
  if (!env.HYPERDRIVE || env.HYPERDRIVE_CACHE_DISABLED !== "true") return;
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 9000,
  });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query(
      "DELETE FROM private.cart_handoff_drafts WHERE token_hash IN (SELECT token_hash FROM private.cart_handoff_drafts WHERE expires_at<now() LIMIT 1000)",
    );
    await client.query(
      "DELETE FROM private.cart_handoff_budget WHERE key IN (SELECT key FROM private.cart_handoff_budget WHERE expires_at<now() LIMIT 1000)",
    );
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

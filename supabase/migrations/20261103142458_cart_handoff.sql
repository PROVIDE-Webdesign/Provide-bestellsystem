CREATE TABLE private.cart_handoff_integrations (
 id text PRIMARY KEY CHECK(id ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
 restaurant_slug text NOT NULL, location_slug text NOT NULL,
 source_origin text NOT NULL CHECK(source_origin ~ '^https://[^/]+$'),
 enabled boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL
);
CREATE TABLE private.cart_handoff_drafts (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 integration_id text NOT NULL REFERENCES private.cart_handoff_integrations(id) ON DELETE CASCADE,
 selection jsonb NOT NULL CHECK(jsonb_typeof(selection)='object' AND octet_length(selection::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 redeemed_by text CHECK(redeemed_by ~ '^[a-f0-9]{64}$'),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE INDEX cart_handoff_expiry_idx ON private.cart_handoff_drafts(expires_at);
CREATE INDEX cart_handoff_integration_idx ON private.cart_handoff_drafts(integration_id,expires_at);
CREATE TABLE private.cart_handoff_budget(key text PRIMARY KEY, uses integer NOT NULL CHECK(uses>0), expires_at timestamptz NOT NULL);
CREATE INDEX cart_handoff_budget_expiry_idx ON private.cart_handoff_budget(expires_at);
ALTER TABLE private.cart_handoff_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.cart_handoff_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.cart_handoff_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.cart_handoff_integrations,private.cart_handoff_drafts,private.cart_handoff_budget FROM PUBLIC,anon,authenticated;
GRANT SELECT ON private.cart_handoff_integrations TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.cart_handoff_drafts,private.cart_handoff_budget TO service_role;

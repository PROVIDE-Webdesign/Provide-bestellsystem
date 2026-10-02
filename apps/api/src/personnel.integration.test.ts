import { Client } from "pg";
import { SignJWT, jwtVerify } from "jose";
import { describe, it, expect } from "vitest";
import {
  parseDashboardAccessContext,
  parsePersonnelState,
  type PersonnelCommand,
} from "@provide/contracts";
import { createApiWorker } from "./index.js";
import { InvalidDashboardTokenError, supabaseDashboardTokenVerifier } from "./dashboard-auth.js";
const db = process.env.TEST_DATABASE_URL,
  url = process.env.TEST_REALTIME_URL,
  key = process.env.TEST_AUTH_ADMIN_KEY,
  secret = process.env.TEST_REALTIME_JWT_SECRET;
describe.skipIf(!db || !url || !key || !secret)(
  "isolated actual Auth invitation and personnel HTTP/PostgreSQL",
  () => {
    it.each(["kitchen", "viewer"] as const)(
      "sends one loopback Auth invite for %s, verifies recipient session, accepts once and revokes existing-token site/order rights",
      async (role) => {
        if (
          !db ||
          !url ||
          !key ||
          !secret ||
          ![db, url].every((v) => ["localhost", "127.0.0.1"].includes(new URL(v).hostname))
        )
          throw Error("Explicit isolated loopback credentials required");
        const admin = new Client({ connectionString: db });
        await admin.connect();
        const r = "f2000000-0000-0000-0000-000000000001",
          l = "f3000000-0000-0000-0000-000000000001",
          owner = "f1000000-0000-0000-0000-000000000001";
        const signingKey = new TextEncoder().encode(secret),
          issuer = `${url}/auth/v1`;
        const ownerToken = await new SignJWT({ aal: "aal2" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(owner)
          .setIssuer(issuer)
          .setAudience("authenticated")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(signingKey);
        const worker = createApiWorker(
          undefined,
          { error: () => undefined },
          undefined,
          undefined,
          undefined,
          {
            verify: async (token, environment) => {
              // Only this exact administrative test token uses the isolated legacy signing secret.
              // Every real recipient session goes through the production asymmetric JWKS verifier.
              if (token !== ownerToken)
                return supabaseDashboardTokenVerifier.verify(token, environment);
              try {
                const { payload } = await jwtVerify(token, signingKey, {
                  algorithms: ["HS256"],
                  issuer,
                  audience: "authenticated",
                });
                if (!payload.sub || (payload.aal !== "aal1" && payload.aal !== "aal2"))
                  throw Error();
                return { userId: payload.sub, aal: payload.aal };
              } catch {
                throw new InvalidDashboardTokenError();
              }
            },
          },
        );
        const env = {
          APP_ENV: "test",
          DASHBOARD_AUTH_ENABLED: "true",
          DASHBOARD_ORDER_OPERATIONS_ENABLED: "true",
          DASHBOARD_PERSONNEL_ENABLED: "true",
          PERSONNEL_INVITATIONS_ENABLED: "true",
          PERSONNEL_DASHBOARD_ORIGIN: "http://127.0.0.1:4321",
          SUPABASE_SERVICE_ROLE_KEY: key,
          SUPABASE_AUTH_ISSUER: issuer,
          SUPABASE_AUTH_AUDIENCE: "authenticated",
          HYPERDRIVE_CACHE_DISABLED: "true",
          HYPERDRIVE: { connectionString: db },
        };
        const responseFor = (q: PersonnelCommand, token = ownerToken) =>
          worker.fetch(
            new Request("https://api.test/v1/dashboard/personnel", {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
              body: JSON.stringify(q),
            }),
            env,
          );
        const send = async (q: PersonnelCommand, token = ownerToken, status = 200) => {
          const response = await responseFor(q, token);
          expect(response.status).toBe(status);
          if (status !== 200) return undefined;
          const envelope = JSON.parse(await response.text()) as { data?: unknown };
          const state = parsePersonnelState(envelope.data);
          expect(!!state).toBe(true);
          return state!;
        };
        const management = async () => {
          const state = await send({ action: "read", restaurantId: r });
          if (state?.mode !== "management") throw Error("Missing management projection");
          return state;
        };
        try {
          const beforeOrders = (
            await admin.query<{ n: string }>("select count(*)::text n from public.orders")
          ).rows[0]!.n;
          const email = `a1-auth-${role}-recipient@example.invalid`;
          const initial = await management();
          const invite: PersonnelCommand = {
            action: "invite",
            restaurantId: r,
            expectedRevision: initial.revision,
            requestId: crypto.randomUUID(),
            reason: "Synthetic real Auth invitation",
            email,
            role,
            locationIds: [l],
          };
          const first = await send(invite);
          if (first?.mode !== "management") throw Error("Missing invitation projection");
          expect(first.dispatches.find((d) => d.id === invite.requestId)?.status).toBe("sent");
          const invitation = first.invitations.find((i) => i.email === email);
          expect(!!invitation).toBe(true);
          const auditCount = async () =>
            (
              await admin.query<{ n: string }>(
                "select count(*)::text n from private.personnel_audit where restaurant_id=$1",
                [r],
              )
            ).rows[0]!.n;
          const once = await auditCount();
          await send(invite);
          expect(await auditCount()).toBe(once);
          // Generate and verify a second loopback-only sign-in proof. No token is logged or persisted.
          const authHeaders = {
            apikey: key,
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          };
          const generated = await fetch(`${issuer}/admin/generate_link`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ type: "magiclink", email }),
          });
          expect(generated.status).toBe(200);
          const link = JSON.parse(await generated.text()) as { hashed_token?: string };
          if (!link.hashed_token) throw Error("Missing isolated recipient proof");
          const verified = await fetch(`${issuer}/verify`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }),
          });
          expect(verified.status).toBe(200);
          const session = JSON.parse(await verified.text()) as {
            access_token?: string;
            user?: { id: string };
          };
          if (!session.access_token || !session.user?.id)
            throw Error("Missing isolated recipient session");
          const recipient = session.user.id,
            token = session.access_token;
          expect(await supabaseDashboardTokenVerifier.verify(token, env)).toEqual({
            userId: recipient,
            aal: "aal1",
          });
          const inbox = await send({ action: "inbox" }, token);
          expect(inbox?.invitations.some((i) => i.id === invitation!.id)).toBe(true);
          await send({ action: "accept", invitationId: invitation!.id }, ownerToken, 403);
          await send({ action: "accept", invitationId: invitation!.id }, token);
          const accepted = await auditCount();
          await send({ action: "accept", invitationId: invitation!.id }, token);
          expect(await auditCount()).toBe(accepted);
          // Existing Auth accounts use OTP without creating or replacing the account.
          const existingEmail = `a1-existing-${role}-recipient@example.invalid`;
          const created = await fetch(`${issuer}/admin/users`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ email: existingEmail, email_confirm: true }),
          });
          expect(created.status).toBe(200);
          const existing = JSON.parse(await created.text()) as { id?: string };
          if (!existing.id) throw Error("Missing isolated existing account");
          const existingState = await management();
          const existingInvite = await send({
            ...invite,
            email: existingEmail,
            expectedRevision: existingState.revision,
            requestId: crypto.randomUUID(),
          });
          if (existingInvite?.mode !== "management")
            throw Error("Missing existing-account projection");
          expect(existingInvite.invitations.some((i) => i.email === existingEmail)).toBe(true);
          expect(
            (
              await admin.query<{ n: string }>(
                "select count(*)::text n from auth.users where lower(email)=$1",
                [existingEmail],
              )
            ).rows[0]!.n,
          ).toBe("1");
          expect(
            (
              await admin.query<{ n: string }>(
                "select count(*)::text n from public.restaurant_memberships where restaurant_id=$1 and user_id=$2",
                [r, existing.id],
              )
            ).rows[0]!.n,
          ).toBe("0");
          const orderAccess = () =>
            worker.fetch(
              new Request(
                `https://api.test/v1/dashboard/restaurants/${r}/locations/${l}/orders${role === "viewer" ? "?status=accepted" : ""}`,
                {
                  headers: { authorization: `Bearer ${token}` },
                },
              ),
              env,
            );
          expect((await orderAccess()).status).toBe(200);
          const accessContext = async () => {
            const response = await worker.fetch(
              new Request("https://api.test/v1/dashboard/access-context", {
                headers: { authorization: `Bearer ${token}` },
              }),
              env,
            );
            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toBe("no-store");
            const envelope: { data?: unknown } = await response.json();
            const context = parseDashboardAccessContext(envelope.data);
            if (!context) throw Error("Missing verified access context");
            return context;
          };
          const beforeBan = await accessContext();
          expect(beforeBan.memberships.some((m) => m.access === "allowed" && m.role === role)).toBe(
            true,
          );
          // Disposable loopback fixture only. Do not refresh/replace the real recipient token.
          await admin.query(
            "update auth.users set banned_until=now()+interval '1 day' where id=$1",
            [recipient],
          );
          try {
            expect((await accessContext()).memberships).toEqual([]);
            expect((await orderAccess()).status).toBe(403);
            expect(await supabaseDashboardTokenVerifier.verify(token, env)).toEqual({
              userId: recipient,
              aal: "aal1",
            });
          } finally {
            await admin.query("update auth.users set banned_until=null where id=$1", [recipient]);
          }
          expect(await accessContext()).toEqual(beforeBan);
          expect((await orderAccess()).status).toBe(200);
          if (role === "viewer") {
            const list: {
              data: {
                orders: { orderId: string; allowedTransitions: string[]; paymentState: unknown }[];
              };
            } = await (await orderAccess()).json();
            expect(list.data.orders.length).toBeGreaterThan(0);
            for (const order of list.data.orders) {
              expect(order.allowedTransitions).toEqual([]);
              expect(order.paymentState).toBeNull();
            }
            const orderId = list.data.orders[0]!.orderId;
            const orderUrl = `https://api.test/v1/dashboard/restaurants/${r}/locations/${l}/orders/${orderId}`;
            const detailResponse = await worker.fetch(
              new Request(orderUrl, { headers: { authorization: `Bearer ${token}` } }),
              env,
            );
            expect(detailResponse.status).toBe(200);
            const detail: {
              data: {
                status: string;
                contactName: unknown;
                delivery: unknown;
                communication?: unknown;
                allowedTransitions: string[];
              };
            } = await detailResponse.json();
            expect(detail.data.contactName).toBeNull();
            expect(detail.data.delivery).toBeNull();
            expect(detail.data.communication).toBeUndefined();
            expect(detail.data.allowedTransitions).toEqual([]);
            expect(detail.data.status).toBe("accepted");
            const mutation = await worker.fetch(
              new Request(`${orderUrl}/status`, {
                method: "POST",
                headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                body: JSON.stringify({
                  expectedStatus: detail.data.status,
                  targetStatus: "preparing",
                }),
              }),
              env,
            );
            expect(mutation.status).toBe(403);
            await send({ action: "read", restaurantId: r }, token, 403);
          }
          let state = await management();
          const base = {
            action: "member" as const,
            restaurantId: r,
            expectedRevision: state.revision,
            requestId: crypto.randomUUID(),
            reason: "Synthetic immediate access revocation",
            userId: recipient,
            role,
            status: "suspended" as const,
            locationIds: [l],
          };
          const competing = await Promise.all([
            responseFor(base),
            responseFor({ ...base, requestId: crypto.randomUUID() }),
          ]);
          expect(competing.map((response) => response.status).sort()).toEqual([200, 409]);
          expect((await orderAccess()).status).toBe(403);
          state = await management();
          await send({
            ...base,
            requestId: crypto.randomUUID(),
            expectedRevision: state.revision,
            status: "active",
          });
          expect((await orderAccess()).status).toBe(200);
          expect(
            (await admin.query<{ n: string }>("select count(*)::text n from public.orders"))
              .rows[0]!.n,
          ).toBe(beforeOrders);
        } finally {
          await admin.end();
        }
      },
      45000,
    );
  },
);

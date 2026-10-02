import { Client } from "pg";
import { SignJWT, jwtVerify } from "jose";
import { describe, it, expect } from "vitest";
import { parsePersonnelState, type PersonnelCommand } from "@provide/contracts";
import { createApiWorker } from "./index.js";
import { InvalidDashboardTokenError } from "./dashboard-auth.js";
const db = process.env.TEST_DATABASE_URL,
  url = process.env.TEST_REALTIME_URL,
  key = process.env.TEST_AUTH_ADMIN_KEY,
  secret = process.env.TEST_REALTIME_JWT_SECRET;
describe.skipIf(!db || !url || !key || !secret)(
  "isolated actual Auth invitation and personnel HTTP/PostgreSQL",
  () => {
    it("sends one loopback Auth invite, verifies recipient session, accepts once and revokes existing-token site/order rights", async () => {
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
          verify: async (token) => {
            try {
              const { payload } = await jwtVerify(token, signingKey, {
                algorithms: ["HS256"],
                issuer,
                audience: "authenticated",
              });
              if (!payload.sub || (payload.aal !== "aal1" && payload.aal !== "aal2")) throw Error();
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
        const email = "a1-auth-recipient@example.invalid";
        const initial = await management();
        const invite: PersonnelCommand = {
          action: "invite",
          restaurantId: r,
          expectedRevision: initial.revision,
          requestId: crypto.randomUUID(),
          reason: "Synthetic real Auth invitation",
          email,
          role: "kitchen",
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
        const inbox = await send({ action: "inbox" }, token);
        expect(inbox?.invitations.some((i) => i.id === invitation!.id)).toBe(true);
        await send({ action: "accept", invitationId: invitation!.id }, ownerToken, 403);
        await send({ action: "accept", invitationId: invitation!.id }, token);
        const accepted = await auditCount();
        await send({ action: "accept", invitationId: invitation!.id }, token);
        expect(await auditCount()).toBe(accepted);
        // Existing Auth accounts use OTP without creating or replacing the account.
        const existingEmail = "a1-existing-recipient@example.invalid";
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
            new Request(`https://api.test/v1/dashboard/restaurants/${r}/locations/${l}/orders`, {
              headers: { authorization: `Bearer ${token}` },
            }),
            env,
          );
        expect((await orderAccess()).status).toBe(200);
        let state = await management();
        const base = {
          action: "member" as const,
          restaurantId: r,
          expectedRevision: state.revision,
          requestId: crypto.randomUUID(),
          reason: "Synthetic immediate access revocation",
          userId: recipient,
          role: "kitchen" as const,
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
          (await admin.query<{ n: string }>("select count(*)::text n from public.orders")).rows[0]!
            .n,
        ).toBe(beforeOrders);
      } finally {
        await admin.end();
      }
    }, 45000);
  },
);

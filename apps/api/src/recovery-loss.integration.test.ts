import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { Client } from "pg";
import { decodeJwt } from "jose";
import { describe, it, expect } from "vitest";
import {
  actualCommand,
  actualResponse,
  actualBusinessDenied,
  totp,
} from "./recovery-proof.integration.js";
import { supabaseRecoveryEffect, type RecoveryProvider } from "./account-recovery.js";
import { orderLiveTopic, parseRecoveryCase } from "@provide/contracts";
const db = process.env.TEST_DATABASE_URL,
  url = process.env.TEST_REALTIME_URL,
  key = process.env.TEST_AUTH_ADMIN_KEY,
  publicKey = process.env.TEST_REALTIME_KEY;
describe.skipIf(!db || !url || !key || !publicKey)(
  "actual isolated independent MFA loss recovery",
  () => {
    it("requires two distinct current operators for a platform identity and reopens only with new actual MFA", async () => {
      if (
        !db ||
        !url ||
        !key ||
        !publicKey ||
        ![db, url].every((v) => ["127.0.0.1", "localhost"].includes(new URL(v).hostname))
      )
        throw Error("Explicit disposable loopback stack required");
      const sql = new Client({ connectionString: db });
      await sql.connect();
      const admin = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const ids: string[] = [],
        clients: SupabaseClient[] = [];
      const restaurantId = crypto.randomUUID(),
        otherRestaurantId = crypto.randomUUID(),
        locationId = crypto.randomUUID();
      const auditTrigger = `a4_test_fault_${crypto.randomUUID().replaceAll("-", "")}`;
      const auditFunction = `private.${auditTrigger}`;
      async function dataRows(token: string, restaurant: string) {
        const response = await fetch(`${url}/rest/v1/restaurants?id=eq.${restaurant}&select=id`, {
          headers: { apikey: publicKey!, authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        return response.json();
      }
      async function join(token: string) {
        const probe = createClient(url!, publicKey!, {
          accessToken: () => Promise.resolve(token),
          auth: { persistSession: false, autoRefreshToken: false },
        });
        clients.push(probe);
        await probe.realtime.setAuth(token);
        const channel = probe.channel(orderLiveTopic(restaurantId, locationId), {
          config: { private: true },
        });
        channel.on("broadcast", { event: "orders.invalidated.v1" }, () => undefined);
        const status = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(Error("Isolated private join timed out")), 12000);
          channel.subscribe((state) => {
            if (
              state === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED ||
              state === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR
            ) {
              clearTimeout(timer);
              resolve(state);
            }
          });
        });
        await probe.removeAllChannels();
        return status;
      }
      async function account(name: string) {
        const email = `a4-${name}-${crypto.randomUUID()}@example.invalid`,
          password = `Synthetic-${crypto.randomUUID()}!`;
        const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        expect(made.error).toBeNull();
        const id = made.data.user!.id;
        ids.push(id);
        const client = createClient(url!, publicKey!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        clients.push(client);
        expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
        const factor = await client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Synthetic loss proof",
        });
        expect(factor.error).toBeNull();
        if (!factor.data || factor.data.type !== "totp") throw Error("No synthetic TOTP");
        expect(
          (
            await client.auth.mfa.challengeAndVerify({
              factorId: factor.data.id,
              code: totp(factor.data.totp.secret),
            })
          ).error,
        ).toBeNull();
        const token = (await client.auth.getSession()).data.session!.access_token;
        const refresh = (await client.auth.getSession()).data.session!.refresh_token;
        return { id, email, password, client, token, refresh, factorId: factor.data.id };
      }
      try {
        const target = await account("target"),
          first = await account("operator-one"),
          second = await account("operator-two");
        const otherSession = createClient(url, publicKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        clients.push(otherSession);
        const aal1Login = await otherSession.auth.signInWithPassword({
          email: target.email,
          password: target.password,
        });
        expect(aal1Login.error).toBeNull();
        const oldAal1 = aal1Login.data.session!.access_token;
        expect(
          (
            await sql.query("select private.account_session_live($1,$2,'aal1') live", [
              target.id,
              decodeJwt(oldAal1).session_id,
            ])
          ).rows[0],
        ).toEqual({ live: true });
        await sql.query(
          "insert into public.restaurants(id,slug,display_name) values($1,$3,'Synthetic A4 first'),($2,$4,'Synthetic A4 second')",
          [restaurantId, otherRestaurantId, `a4-${restaurantId}`, `a4-${otherRestaurantId}`],
        );
        await sql.query(
          "insert into public.locations(id,restaurant_id,slug,display_name) values($1,$2,'proof','Synthetic A4 location')",
          [locationId, restaurantId],
        );
        await sql.query(
          "insert into public.restaurant_memberships(restaurant_id,user_id,role,status,suspended_at) values($1,$3,'owner','active',null),($2,$3,'viewer','suspended',now())",
          [restaurantId, otherRestaurantId, target.id],
        );
        const beforeMemberships = (
          await sql.query(
            "select restaurant_id,role,status from public.restaurant_memberships where user_id=$1 order by restaurant_id",
            [target.id],
          )
        ).rows;
        expect(await dataRows(target.token, restaurantId)).toEqual([{ id: restaurantId }]);
        expect(await dataRows(target.token, otherRestaurantId)).toEqual([]);
        expect(await join(target.token)).toBe(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
        await sql.query("insert into private.account_recovery_grants(user_id) values($1),($2)", [
          first.id,
          second.id,
        ]);
        await sql.query("insert into private.provide_admin_grants(user_id) values($1)", [
          target.id,
        ]);
        const contactId = crypto.randomUUID();
        await sql.query(
          "insert into private.account_recovery_contacts(id,user_id,reference) values($1,$2,'prior-agreed-synthetic')",
          [contactId, target.id],
        );
        const storage = new Map<string, string>();
        const recovery = createClient(url, publicKey, {
          auth: {
            flowType: "pkce",
            detectSessionInUrl: false,
            autoRefreshToken: false,
            storage: {
              getItem: (k) => storage.get(k) ?? null,
              setItem: (k, v) => {
                storage.set(k, v);
              },
              removeItem: (k) => {
                storage.delete(k);
              },
            },
          },
        });
        clients.push(recovery);
        expect(
          (
            await recovery.auth.resetPasswordForEmail(target.email, {
              redirectTo: "http://127.0.0.1:4321/auth/recovery",
            })
          ).error,
        ).toBeNull();
        const issued = (
          await sql.query<{ recovery_token: string }>(
            "select recovery_token from auth.users where id=$1",
            [target.id],
          )
        ).rows[0]!.recovery_token;
        const verify = new URL(`${url}/auth/v1/verify`);
        verify.searchParams.set("token", issued);
        verify.searchParams.set("type", "recovery");
        verify.searchParams.set("redirect_to", "http://127.0.0.1:4321/auth/recovery");
        const response = await fetch(verify, { redirect: "manual" });
        expect([302, 303]).toContain(response.status);
        const redirect = new URL(response.headers.get("location")!);
        await response.body?.cancel();
        expect(redirect.origin).toBe("http://127.0.0.1:4321");
        expect(redirect.pathname).toBe("/auth/recovery");
        expect(redirect.hash).toBe("");
        const exchange = await recovery.auth.exchangeCodeForSession(
          redirect.searchParams.get("code")!,
        );
        expect(exchange.error).toBeNull();
        const recoveryToken = exchange.data.session!.access_token;
        const c = await actualCommand(recoveryToken, {
          action: "request",
          caseId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          kind: "lost_factor",
          reason: "factor_lost",
        });
        expect(c.requiredApprovals).toBe(2);
        expect(
          (
            await sql.query<{ blocked: boolean }>(
              "select blocked from private.account_security_state where user_id=$1",
              [target.id],
            )
          ).rows[0]!.blocked,
        ).toBe(false);
        const checked = await actualCommand(first.token, {
          action: "verify",
          caseId: c.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: c.revision,
          contactId,
          evidenceReference: "independent-synthetic-proof",
        });
        const concurrent = await Promise.all(
          [first, second].map((operator) =>
            actualResponse(operator.token, {
              action: "approve",
              caseId: c.caseId,
              commandId: crypto.randomUUID(),
              expectedRevision: checked.revision,
            }),
          ),
        );
        expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
        const winner = concurrent.find((r) => r.status === 200)!;
        const body: unknown = await winner.json();
        const one =
          body && typeof body === "object" && "data" in body
            ? parseRecoveryCase(body.data)
            : undefined;
        if (!one) throw Error("No concurrent approval projection");
        expect(one.state).toBe("verified");
        const retryOperator = concurrent[0]!.status === 409 ? first : second;
        const approved = await actualCommand(retryOperator.token, {
          action: "approve",
          caseId: c.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: one.revision,
        });
        expect(approved.state).toBe("approved");
        const execute = {
          action: "execute",
          caseId: c.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: approved.revision,
        } as const;
        // Disposable DB-only fault fixture: actual Auth commits, response is lost, then audit insert fails.
        await sql.query(
          `create function ${auditFunction}() returns trigger language plpgsql as $$ begin if new.case_id::text=TG_ARGV[0] and new.action=TG_ARGV[1] then raise exception 'Synthetic isolated audit fault';end if;return new;end $$`,
        );
        await sql.query(
          `create trigger ${auditTrigger} before insert on private.account_recovery_audit for each row execute function ${auditFunction}('${c.caseId}','execute')`,
        );
        let providerCalls = 0;
        const lostResponse: RecoveryProvider = async (...args) => {
          providerCalls++;
          await supabaseRecoveryEffect(...args);
          throw Error("Synthetic response lost after real Auth commit");
        };
        const beforeEffect = await actualResponse(first.token, execute, undefined, {
          provider: lostResponse,
        });
        expect(beforeEffect.status).toBe(503);
        expect(providerCalls).toBe(0);
        expect(
          (
            await sql.query("select blocked from private.account_security_state where user_id=$1", [
              target.id,
            ])
          ).rows[0],
        ).toEqual({ blocked: false });
        expect(
          (await admin.auth.admin.mfa.listFactors({ userId: target.id })).data!.factors,
        ).toHaveLength(1);
        await sql.query(`drop trigger ${auditTrigger} on private.account_recovery_audit`);
        await sql.query(
          `create trigger ${auditTrigger} before insert on private.account_recovery_audit for each row execute function ${auditFunction}('${c.caseId}','effect_reconciled')`,
        );
        const failed = await actualResponse(first.token, execute, undefined, {
          provider: lostResponse,
        });
        expect(failed.status).toBe(503);
        expect(await failed.text()).not.toContain("Synthetic");
        expect(
          (
            await sql.query("select state from private.account_recovery_cases where id=$1", [
              c.caseId,
            ])
          ).rows[0],
        ).toEqual({ state: "executing" });
        expect(
          (
            await sql.query("select blocked from private.account_security_state where user_id=$1", [
              target.id,
            ])
          ).rows[0],
        ).toEqual({ blocked: true });
        await sql.query(`drop trigger ${auditTrigger} on private.account_recovery_audit`);
        await sql.query(`drop function ${auditFunction}()`);
        const awaiting = await actualCommand(first.token, execute, undefined, {
          provider: lostResponse,
        });
        expect(providerCalls).toBe(1);
        expect(awaiting.state).toBe("awaiting_reenrollment");
        const changed = await actualResponse(
          first.token,
          { ...execute, expectedRevision: awaiting.revision },
          undefined,
          { provider: lostResponse },
        );
        expect(changed.status).toBe(409);
        await sql.query(
          "update private.account_recovery_grants set active=false where user_id=$1",
          [first.id],
        );
        expect(
          (await actualResponse(first.token, execute, undefined, { provider: lostResponse }))
            .status,
        ).toBe(403);
        expect(providerCalls).toBe(1);
        await sql.query("update private.account_recovery_grants set active=true where user_id=$1", [
          first.id,
        ]);
        await actualBusinessDenied(target.token, restaurantId, locationId);
        await actualBusinessDenied(oldAal1, restaurantId, locationId);
        expect(await dataRows(target.token, restaurantId)).toEqual([]);
        expect(await join(target.token)).toBe(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
        expect(
          (await admin.auth.admin.mfa.listFactors({ userId: target.id })).data!.factors,
        ).toHaveLength(0);
        expect(
          (await sql.query("select id from auth.sessions where user_id=$1", [target.id])).rowCount,
        ).toBe(0);
        expect((await recovery.auth.refreshSession()).error).toBeTruthy();
        expect(
          (
            await target.client.auth.signInWithPassword({
              email: target.email,
              password: target.password,
            })
          ).error,
        ).toBeNull();
        const freshFactor = await target.client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Synthetic recovered",
        });
        expect(freshFactor.error).toBeNull();
        if (!freshFactor.data || freshFactor.data.type !== "totp")
          throw Error("No new synthetic factor");
        expect(
          (
            await target.client.auth.mfa.challengeAndVerify({
              factorId: freshFactor.data.id,
              code: totp(freshFactor.data.totp.secret),
            })
          ).error,
        ).toBeNull();
        const fresh = (await target.client.auth.getSession()).data.session!.access_token;
        await actualBusinessDenied(fresh, restaurantId, locationId);
        const complete = await actualCommand(fresh, {
          action: "complete",
          caseId: c.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: awaiting.revision,
        });
        expect(complete.state).toBe("completed");
        for (const oldRefresh of [target.refresh, aal1Login.data.session!.refresh_token]) {
          const rejected = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST",
            headers: { apikey: publicKey, "content-type": "application/json" },
            body: JSON.stringify({ refresh_token: oldRefresh }),
          });
          expect([400, 401]).toContain(rejected.status);
          await rejected.body?.cancel();
        }
        expect(await dataRows(fresh, restaurantId)).toEqual([{ id: restaurantId }]);
        expect(await dataRows(fresh, otherRestaurantId)).toEqual([]);
        expect(
          (
            await sql.query(
              "select restaurant_id,role,status from public.restaurant_memberships where user_id=$1 order by restaurant_id",
              [target.id],
            )
          ).rows,
        ).toEqual(beforeMemberships);
        await actualBusinessDenied(target.token, restaurantId, locationId);
        expect(
          (
            await sql.query<{ live: boolean }>(
              "select private.account_session_live($1,$2,'aal2') live",
              [target.id, decodeJwt(target.token).session_id],
            )
          ).rows[0]!.live,
        ).toBe(false);
        expect(
          (
            await sql.query<{ live: boolean }>(
              "select private.account_session_live($1,$2,'aal2') live",
              [target.id, decodeJwt(fresh).session_id],
            )
          ).rows[0]!.live,
        ).toBe(true);
        expect(
          (
            await sql.query(
              "select id from private.provide_admin_grants where user_id=$1 and active",
              [target.id],
            )
          ).rowCount,
        ).toBe(1);
        const actors = (
          await sql.query<{ actor_user_id: string; action: string }>(
            "select actor_user_id,action from private.account_recovery_audit where case_id=$1 order by id",
            [c.caseId],
          )
        ).rows;
        expect(
          actors
            .filter((a) => a.action === "approve")
            .map((a) => a.actor_user_id)
            .sort(),
        ).toEqual([first.id, second.id].sort());
        console.info(
          "A4 actual MFA-loss evidence: two distinct operators, Admin factor removal, all old sessions revoked, new actual TOTP completion, grant unchanged, exact command actors",
        );
      } finally {
        await sql
          .query(`drop trigger if exists ${auditTrigger} on private.account_recovery_audit`)
          .catch(() => undefined);
        await sql.query(`drop function if exists ${auditFunction}()`).catch(() => undefined);
        await sql.query("delete from public.locations where id=$1", [locationId]);
        await sql.query("delete from public.restaurants where id=any($1::uuid[])", [
          [restaurantId, otherRestaurantId],
        ]);
        for (const client of clients) await client.removeAllChannels();
        for (const id of ids) await admin.auth.admin.deleteUser(id);
        for (const client of clients) await client.auth.signOut();
        await sql.end();
      }
    }, 60000);
  },
);

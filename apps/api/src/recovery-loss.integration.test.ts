import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { decodeJwt } from "jose";
import { describe, it, expect } from "vitest";
import { actualCommand, totp } from "./recovery-proof.integration.js";
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
        return { id, email, password, client, token, factorId: factor.data.id };
      }
      try {
        const target = await account("target"),
          first = await account("operator-one"),
          second = await account("operator-two");
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
        const one = await actualCommand(first.token, {
          action: "approve",
          caseId: c.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: checked.revision,
        });
        expect(one.state).toBe("verified");
        const approved = await actualCommand(second.token, {
          action: "approve",
          caseId: c.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: one.revision,
        });
        expect(approved.state).toBe("approved");
        const awaiting = await actualCommand(first.token, {
          action: "execute",
          caseId: c.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: approved.revision,
        });
        expect(awaiting.state).toBe("awaiting_reenrollment");
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
        const complete = await actualCommand(fresh, {
          action: "complete",
          caseId: c.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: awaiting.revision,
        });
        expect(complete.state).toBe("completed");
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
        expect(actors.filter((a) => a.action === "approve").map((a) => a.actor_user_id)).toEqual([
          first.id,
          second.id,
        ]);
        console.info(
          "A4 actual MFA-loss evidence: two distinct operators, Admin factor removal, all old sessions revoked, new actual TOTP completion, grant unchanged, exact command actors",
        );
      } finally {
        for (const id of ids) await admin.auth.admin.deleteUser(id);
        for (const client of clients) await client.auth.signOut();
        await sql.end();
      }
    }, 60000);
  },
);

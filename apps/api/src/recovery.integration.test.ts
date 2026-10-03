import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { totp, actualCommand } from "./recovery-proof.integration.js";

const db = process.env.TEST_DATABASE_URL;
const url = process.env.TEST_REALTIME_URL;
const key = process.env.TEST_AUTH_ADMIN_KEY;
const publicKey = process.env.TEST_REALTIME_KEY;

describe.skipIf(!db || !url || !key || !publicKey)("isolated actual A4 Auth provider", () => {
  it("proves actual PKCE password recovery, provider-bound purpose, verifier rejection and single-use exchange", async () => {
    if (
      !db ||
      !url ||
      !key ||
      !publicKey ||
      ![db, url].every((v) => ["localhost", "127.0.0.1"].includes(new URL(v).hostname))
    )
      throw Error("Explicit disposable loopback stack required");
    const sql = new Client({ connectionString: db });
    await sql.connect();
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const storage = new Map<string, string>();
    const recovery = createClient(url, publicKey, {
      auth: {
        flowType: "pkce",
        autoRefreshToken: false,
        detectSessionInUrl: false,
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
    const wrongContext = createClient(url, publicKey, {
      auth: {
        flowType: "pkce",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const email = `a4-pkce-${crypto.randomUUID()}@example.invalid`;
    const password = `Synthetic-only-${crypto.randomUUID()}!`;
    const nextPassword = `Synthetic-next-${crypto.randomUUID()}!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error?.message).toBeUndefined();
    const id = created.data.user!.id;
    try {
      const unknownEmail = `a4-unknown-${crypto.randomUUID()}@example.invalid`;
      expect(
        (
          await wrongContext.auth.resetPasswordForEmail(unknownEmail, {
            redirectTo: "http://127.0.0.1:4321/auth/recovery",
          })
        ).error,
      ).toBeNull();
      expect(
        (await sql.query("select id from auth.users where email=$1", [unknownEmail])).rowCount,
      ).toBe(0);
      const sent = await recovery.auth.resetPasswordForEmail(email, {
        redirectTo: "http://127.0.0.1:4321",
      });
      expect(sent.error?.message).toBeUndefined();
      const repeated = await fetch(`${url}/auth/v1/recover`, {
        method: "POST",
        headers: { apikey: publicKey, "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      expect(repeated.status).toBe(429);
      await repeated.body?.cancel();
      const invalid = await fetch(`${url}/auth/v1/recover`, {
        method: "POST",
        headers: { apikey: publicKey, "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      });
      expect([400, 422]).toContain(invalid.status);
      await invalid.body?.cancel();
      expect(
        (
          await sql.query("select blocked from private.account_security_state where user_id=$1", [
            id,
          ])
        ).rows[0],
      ).toEqual({ blocked: false });
      // Read only the provider-issued hash in this disposable DB. No generated or synthetic
      // substitute session: Auth verifies its own recovery token and emits the actual PKCE code.
      const row = (
        await sql.query<{ recovery_token: string }>(
          "select recovery_token from auth.users where id=$1",
          [id],
        )
      ).rows[0];
      if (!row?.recovery_token) throw Error("Missing isolated provider-issued recovery proof");
      const verifyUrl = new URL(`${url}/auth/v1/verify`);
      verifyUrl.searchParams.set("token", row.recovery_token);
      verifyUrl.searchParams.set("type", "recovery");
      verifyUrl.searchParams.set("redirect_to", "http://127.0.0.1:4321");
      const verified = await fetch(verifyUrl, { redirect: "manual" });
      expect([302, 303]).toContain(verified.status);
      const redirect = verified.headers.get("location");
      await verified.body?.cancel();
      if (!redirect) throw Error("Missing isolated PKCE redirect");
      const destination = new URL(redirect);
      expect(destination.origin).toBe("http://127.0.0.1:4321");
      expect(destination.hash).toBe("");
      const code = destination.searchParams.get("code");
      if (!code) throw Error("Provider did not issue a PKCE recovery code");
      expect((await wrongContext.auth.exchangeCodeForSession(code)).error).toBeTruthy();
      const exchanged = await recovery.auth.exchangeCodeForSession(code);
      expect(exchanged.error?.message).toBeUndefined();
      const token = exchanged.data.session!.access_token;
      const oldRefresh = exchanged.data.session!.refresh_token;
      const claims = decodeJwt(token);
      expect(claims.sub).toBe(id);
      expect(
        Array.isArray(claims.amr) &&
          claims.amr.some((v: { method?: string }) => v.method === "recovery"),
      ).toBe(true);
      const methods = (
        await sql.query<{ authentication_method: string }>(
          "select authentication_method from auth.mfa_amr_claims where session_id=$1",
          [claims.session_id],
        )
      ).rows.map((r) => r.authentication_method);
      expect(methods).toContain("recovery");
      expect((await recovery.auth.exchangeCodeForSession(code)).error).toBeTruthy();
      const recoveryCase = await actualCommand(token, {
        action: "request",
        caseId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        kind: "password",
        reason: "forgot_password",
      });
      expect(recoveryCase.state).toBe("requested");
      const awaiting = await actualCommand(
        token,
        {
          action: "begin_password",
          caseId: recoveryCase.caseId,
          commandId: crypto.randomUUID(),
          expectedRevision: recoveryCase.revision,
        },
        nextPassword,
      );
      expect(awaiting.state).toBe("awaiting_reenrollment");
      expect(
        (await sql.query("select id from auth.sessions where user_id=$1", [id])).rowCount,
      ).toBe(0);
      expect((await recovery.auth.refreshSession()).error).toBeTruthy();
      const login = createClient(url, publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await login.auth.signInWithPassword({ email, password })).error).toBeTruthy();
      const newSession = await login.auth.signInWithPassword({ email, password: nextPassword });
      expect(newSession.error?.message).toBeUndefined();
      expect(decodeJwt(newSession.data.session!.access_token).session_id).not.toBe(
        claims.session_id,
      );
      const newToken = newSession.data.session!.access_token;
      const completed = await actualCommand(newToken, {
        action: "complete",
        caseId: awaiting.caseId,
        commandId: crypto.randomUUID(),
        expectedRevision: awaiting.revision,
      });
      expect(completed.state).toBe("completed");
      const staleRefresh = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: publicKey },
        body: JSON.stringify({ refresh_token: oldRefresh }),
      });
      expect([400, 401]).toContain(staleRefresh.status);
      await staleRefresh.body?.cancel();
      expect(
        (
          await sql.query<{ live: boolean }>("select private.account_session_live($1,$2,$3) live", [
            id,
            claims.session_id,
            claims.aal,
          ])
        ).rows[0]!.live,
      ).toBe(false);
      const newClaims = decodeJwt(newToken);
      expect(
        (
          await sql.query<{ live: boolean }>("select private.account_session_live($1,$2,$3) live", [
            id,
            newClaims.session_id,
            newClaims.aal,
          ])
        ).rows[0]!.live,
      ).toBe(true);
      await login.auth.signOut();
      const actionTypes = (
        await sql.query<{ action: string }>(
          "select distinct payload->>'action' action from auth.audit_log_entries where payload->>'actor_id'=$1 order by 1",
          [id],
        )
      ).rows.map((r) => r.action);
      console.info(
        "A4 isolated PKCE evidence (no credentials):",
        JSON.stringify({
          verifiedPurpose: methods,
          wrongBrowserRejected: true,
          singleUseCode: true,
          oldPasswordRejected: true,
          newSession: true,
          actionTypes,
        }),
      );
    } finally {
      await recovery.auth.signOut();
      await wrongContext.auth.signOut();
      await admin.auth.admin.deleteUser(id);
      await sql.end();
    }
  }, 30000);

  it("proves real TOTP, direct unenroll, Admin list/delete and stale-session semantics", async () => {
    if (
      !db ||
      !url ||
      !key ||
      !publicKey ||
      ![db, url].every((v) => ["localhost", "127.0.0.1"].includes(new URL(v).hostname))
    )
      throw Error("Explicit disposable loopback stack required");
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const sql = new Client({ connectionString: db });
    await sql.connect();
    const email = `a4-probe-${crypto.randomUUID()}@example.invalid`;
    const password = `Synthetic-only-${crypto.randomUUID()}!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error?.message).toBeUndefined();
    const id = created.data.user!.id;
    try {
      const signed = await user.auth.signInWithPassword({ email, password });
      expect(signed.error?.message).toBeUndefined();
      const enrolled = await user.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Synthetic A4",
      });
      expect(enrolled.error?.message).toBeUndefined();
      if (!enrolled.data || enrolled.data.type !== "totp") throw Error("No synthetic TOTP");
      const verified = await user.auth.mfa.challengeAndVerify({
        factorId: enrolled.data.id,
        code: totp(enrolled.data.totp.secret),
      });
      expect(verified.error?.message).toBeUndefined();
      const token = (await user.auth.getSession()).data.session!.access_token;
      const claims = decodeJwt(token);
      expect(claims.aal).toBe("aal2");
      expect(typeof claims.session_id).toBe("string");
      const session = await sql.query<{ user_id: string }>(
        "select user_id, created_at from auth.sessions where id=$1",
        [claims.session_id],
      );
      expect(session.rows[0]?.user_id).toBe(id);
      const live = async () =>
        (
          await sql.query<{ live: boolean }>("select private.account_session_live($1,$2,$3) live", [
            id,
            claims.session_id,
            claims.aal,
          ])
        ).rows[0]!.live;
      expect(await live()).toBe(true);
      const list = await admin.auth.admin.mfa.listFactors({ userId: id });
      expect(list.error?.message).toBeUndefined();
      expect(list.data!.factors.some((f) => f.id === enrolled.data.id)).toBe(true);
      const removed = await user.auth.mfa.unenroll({ factorId: enrolled.data.id });
      expect(removed.error?.message).toBeUndefined();
      expect(decodeJwt(token).aal).toBe("aal2");
      expect(await live()).toBe(false);
      const observed = (
        await sql.query<{ source: string; actor_user_id: string | null }>(
          "select source,actor_user_id from private.account_security_events where target_user_id=$1 and action='verified_factor_removed'",
          [id],
        )
      ).rows;
      expect(observed).toEqual([{ source: "provider_observation", actor_user_id: null }]);
      const second = await user.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Synthetic A4 replacement",
      });
      expect(second.error?.message).toBeUndefined();
      const deleted = await admin.auth.admin.mfa.deleteFactor({ userId: id, id: second.data!.id });
      expect(deleted.error?.message).toBeUndefined();
      expect((await admin.auth.admin.mfa.listFactors({ userId: id })).data!.factors).toHaveLength(
        0,
      );
      const signedOut = await admin.auth.admin.signOut(token, "global");
      expect(signedOut.error?.message).toBeUndefined();
      expect(
        (await sql.query("select id from auth.sessions where id=$1", [claims.session_id])).rowCount,
      ).toBe(0);
      const actions = (
        await sql.query(
          "select distinct payload->>'action' action from auth.audit_log_entries where payload->>'actor_id'=$1 order by 1",
          [id],
        )
      ).rows.map((r: { action: string }) => r.action);
      const columns = (
        await sql.query(
          "select column_name from information_schema.columns where table_schema='auth' and table_name='sessions' order by ordinal_position",
        )
      ).rows.map((r: { column_name: string }) => r.column_name);
      console.info(
        "A4 isolated provider evidence (no credentials):",
        JSON.stringify({
          actions,
          sessionColumns: columns,
          staleTokenAal: claims.aal,
          revokedSessionAbsent: true,
        }),
      );
    } finally {
      await admin.auth.admin.deleteUser(id);
      await user.auth.signOut();
      await sql.end();
    }
  }, 30000);
  it("replaces a factor only after old-session binding and new verification, then requires a new actual MFA session", async () => {
    if (
      !db ||
      !url ||
      !key ||
      !publicKey ||
      ![db, url].every((v) => ["127.0.0.1", "localhost"].includes(new URL(v).hostname))
    )
      throw Error("Explicit disposable loopback stack required");
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const sql = new Client({ connectionString: db });
    await sql.connect();
    const email = `a4-replacement-${crypto.randomUUID()}@example.invalid`,
      password = `Synthetic-${crypto.randomUUID()}!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(made.error).toBeNull();
    const id = made.data.user!.id;
    try {
      expect((await user.auth.signInWithPassword({ email, password })).error).toBeNull();
      const old = await user.auth.mfa.enroll({ factorType: "totp", friendlyName: "Synthetic old" });
      expect(old.error).toBeNull();
      if (!old.data || old.data.type !== "totp") throw Error("No synthetic old factor");
      expect(
        (
          await user.auth.mfa.challengeAndVerify({
            factorId: old.data.id,
            code: totp(old.data.totp.secret),
          })
        ).error,
      ).toBeNull();
      const oldToken = (await user.auth.getSession()).data.session!.access_token;
      const bound = await actualCommand(oldToken, {
        action: "request",
        caseId: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        kind: "replace_factor",
        reason: "factor_replaced",
        oldFactorId: old.data.id,
      });
      const next = await user.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Synthetic new",
      });
      expect(next.error).toBeNull();
      if (!next.data || next.data.type !== "totp") throw Error("No synthetic new factor");
      expect(
        (
          await user.auth.mfa.challengeAndVerify({
            factorId: next.data.id,
            code: totp(next.data.totp.secret),
          })
        ).error,
      ).toBeNull();
      const token = (await user.auth.getSession()).data.session!.access_token;
      expect(decodeJwt(token).session_id).toBe(decodeJwt(oldToken).session_id);
      const awaiting = await actualCommand(token, {
        action: "begin_replacement",
        caseId: bound.caseId,
        commandId: crypto.randomUUID(),
        expectedRevision: bound.revision,
        newFactorId: next.data.id,
      });
      expect(awaiting.state).toBe("awaiting_reenrollment");
      const listed = await admin.auth.admin.mfa.listFactors({ userId: id });
      expect(listed.data!.factors.map((f) => f.id)).toEqual([next.data.id]);
      expect((await user.auth.refreshSession()).error).toBeTruthy();
      expect((await user.auth.signInWithPassword({ email, password })).error).toBeNull();
      expect(
        (
          await user.auth.mfa.challengeAndVerify({
            factorId: next.data.id,
            code: totp(next.data.totp.secret),
          })
        ).error,
      ).toBeNull();
      const fresh = (await user.auth.getSession()).data.session!.access_token;
      const done = await actualCommand(fresh, {
        action: "complete",
        caseId: awaiting.caseId,
        commandId: crypto.randomUUID(),
        expectedRevision: awaiting.revision,
      });
      expect(done.state).toBe("completed");
      expect(
        (
          await sql.query<{ live: boolean }>(
            "select private.account_session_live($1,$2,'aal2') live",
            [id, decodeJwt(oldToken).session_id],
          )
        ).rows[0]!.live,
      ).toBe(false);
      console.info(
        "A4 actual controlled replacement evidence: old-bound, new-verified, provider-removed, old-refresh-rejected, fresh-MFA-completed",
      );
    } finally {
      await admin.auth.admin.deleteUser(id);
      await user.auth.signOut();
      await sql.end();
    }
  }, 30000);
});

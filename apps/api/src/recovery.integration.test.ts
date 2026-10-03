import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createHmac } from "node:crypto";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";

const db = process.env.TEST_DATABASE_URL;
const url = process.env.TEST_REALTIME_URL;
const key = process.env.TEST_AUTH_ADMIN_KEY;
const publicKey = process.env.TEST_REALTIME_KEY;

function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=/g, "").toUpperCase()) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw Error("Invalid synthetic TOTP secret");
    bits += n.toString(2).padStart(5, "0");
  }
  const bytes = Uint8Array.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 30000)));
  const hmac = createHmac("sha1", bytes).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  return (
    (new DataView(hmac.buffer, hmac.byteOffset, hmac.byteLength).getUint32(offset) & 0x7fffffff) %
    1000000
  )
    .toString()
    .padStart(6, "0");
}

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
      const sent = await recovery.auth.resetPasswordForEmail(email, {
        redirectTo: "http://127.0.0.1:4321",
      });
      expect(sent.error?.message).toBeUndefined();
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
      const changed = await recovery.auth.updateUser({ password: nextPassword });
      expect(changed.error?.message).toBeUndefined();
      const login = createClient(url, publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await login.auth.signInWithPassword({ email, password })).error).toBeTruthy();
      const newSession = await login.auth.signInWithPassword({ email, password: nextPassword });
      expect(newSession.error?.message).toBeUndefined();
      expect(decodeJwt(newSession.data.session!.access_token).session_id).not.toBe(
        claims.session_id,
      );
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
      const list = await admin.auth.admin.mfa.listFactors({ userId: id });
      expect(list.error?.message).toBeUndefined();
      expect(list.data!.factors.some((f) => f.id === enrolled.data.id)).toBe(true);
      const removed = await user.auth.mfa.unenroll({ factorId: enrolled.data.id });
      expect(removed.error?.message).toBeUndefined();
      expect(decodeJwt(token).aal).toBe("aal2");
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
});

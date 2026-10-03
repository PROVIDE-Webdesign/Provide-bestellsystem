import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { describe, it, expect } from "vitest";
import { parseSupportState, type SupportCommand } from "@provide/contracts";
import { createApiWorker } from "./index.js";
import { totp } from "./recovery-proof.integration.js";
import { handleSupport, postgresSupport } from "./support.js";
import { supabaseDashboardTokenVerifier } from "./dashboard-auth.js";
const db = process.env.TEST_DATABASE_URL,
  url = process.env.TEST_REALTIME_URL,
  key = process.env.TEST_AUTH_ADMIN_KEY,
  publicKey = process.env.TEST_REALTIME_KEY;
describe.skipIf(!db || !url || !key || !publicKey)(
  "O1 actual isolated Auth / HTTP / PostgreSQL",
  () => {
    it("enforces explicit MFA grants, current session/recovery locks, concurrent revisions, request replay and atomic audit rollback", async () => {
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
        }),
        user = createClient(url, publicKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      const email = `o1-${crypto.randomUUID()}@example.invalid`,
        password = `Synthetic-${crypto.randomUUID()}!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      expect(created.error).toBeNull();
      const id = created.data.user!.id;
      const restaurantId = "f2000000-0000-0000-0000-000000000001",
        locationId = "f3000000-0000-0000-0000-000000000001",
        scope = { restaurantId, locationId };
      const worker = createApiWorker();
      const env = {
        APP_ENV: "test",
        DASHBOARD_AUTH_ENABLED: "true",
        SUPPORT_CASES_ENABLED: "true",
        SUPABASE_AUTH_ISSUER: `${url}/auth/v1`,
        SUPABASE_AUTH_AUDIENCE: "authenticated",
        HYPERDRIVE_CACHE_DISABLED: "true",
        HYPERDRIVE: { connectionString: db },
      };
      const read = { action: "read", ...scope, caseId: null, cursor: null } as const;
      const response = (q: SupportCommand, token: string) =>
        worker.fetch(
          new Request("https://isolated-api.test/v1/provide/support", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify(q),
          }),
          env,
        );
      const send = async (q: SupportCommand, token: string, status = 200) => {
        const r = await response(q, token);
        expect(r.status, await r.clone().text()).toBe(status);
        if (status !== 200) return null;
        const envelope = await r.json();
        const data = parseSupportState(
          envelope && typeof envelope === "object" && "data" in envelope
            ? envelope.data
            : undefined,
        );
        expect(data).toBeDefined();
        return data!;
      };
      let token = "";
      const requestId = crypto.randomUUID();
      try {
        const login = await user.auth.signInWithPassword({ email, password });
        expect(login.error).toBeNull();
        const aal1 = login.data.session!.access_token;
        await sql.query(
          "insert into private.support_grants(user_id,restaurant_id,location_id,can_read,can_manage)values($1,$2,$3,true,true)",
          [id, restaurantId, locationId],
        );
        await send(read, aal1, 403);
        const factor = await user.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Synthetic O1 proof",
        });
        expect(factor.error).toBeNull();
        if (!factor.data || factor.data.type !== "totp") throw Error("No synthetic TOTP");
        const verified = await user.auth.mfa.challengeAndVerify({
          factorId: factor.data.id,
          code: totp(factor.data.totp.secret),
        });
        expect(verified.error).toBeNull();
        token = verified.data!.access_token;
        await send(read, token);
        await send(
          {
            ...read,
            restaurantId: "f2000000-0000-0000-0000-000000000002",
            locationId: "f3000000-0000-0000-0000-000000000002",
          },
          token,
          403,
        );
        const create = {
          action: "create",
          ...scope,
          requestId,
          kind: "incident",
          sourceId: null,
          severity: "critical",
          reason: "incident_recorded",
        } as const;
        let state = (await send(create, token))!;
        const c = state.cases[0]!;
        const auditCount = async () =>
          (
            await sql.query<{ n: string }>(
              "select count(*)::text n from private.support_audit where case_id=$1",
              [c.caseId],
            )
          ).rows[0]!.n;
        const before = await auditCount();
        await send(create, token);
        expect(await auditCount()).toBe(before);
        await send({ ...create, severity: "normal" }, token, 409);
        const change = {
          action: "update",
          ...scope,
          requestId: crypto.randomUUID(),
          caseId: c.caseId,
          expectedRevision: 1,
          operation: "claim",
          assigneeUserId: null,
          state: null,
          severity: null,
          deadline: null,
          reason: "handover",
          sourceFingerprint: null,
        } as const;
        const commands = [change, { ...change, requestId: crypto.randomUUID() }];
        const results = await Promise.all(commands.map((q) => response(q, token)));
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        const winner = commands[results.findIndex((r) => r.status === 200)]!;
        const count = await auditCount();
        await send(winner, token);
        expect(await auditCount()).toBe(count);
        await sql.query("update private.support_grants set active=false where user_id=$1", [id]);
        await send(read, token, 403);
        await send(winner, token, 403);
        await sql.query(
          "update private.support_grants set active=true,can_manage=false where user_id=$1",
          [id],
        );
        expect((await send(read, token))?.canManage).toBe(false);
        await send(winner, token, 403);
        await sql.query("update private.support_grants set can_manage=true where user_id=$1", [id]);
        await sql.query(
          "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1",
          [id],
        );
        await send(read, token, 403);
        await sql.query("update auth.users set banned_until=null where id=$1", [id]);
        await sql.query("update private.account_security_state set blocked=true where user_id=$1", [
          id,
        ]);
        await send(read, token, 403);
        await sql.query(
          "update private.account_security_state set blocked=false where user_id=$1",
          [id],
        );
        state = (await send({ ...read, caseId: c.caseId }, token))!;
        await sql.query(
          `create function private.o1_test_audit_failure()returns trigger language plpgsql as $$begin raise exception 'synthetic O1 audit failure';end$$;create trigger o1_test_audit_failure before insert on private.support_audit for each row execute function private.o1_test_audit_failure()`,
        );
        const failed = {
          ...change,
          requestId: crypto.randomUUID(),
          expectedRevision: state.cases[0]!.revision,
        };
        await send(failed, token, 503);
        await sql.query(
          "drop trigger o1_test_audit_failure on private.support_audit;drop function private.o1_test_audit_failure()",
        );
        expect((await send({ ...read, caseId: c.caseId }, token))?.cases[0]?.revision).toBe(
          state.cases[0]!.revision,
        );
        expect(await auditCount()).toBe(count);
        await send(failed, token); // Failed transaction saved no receipt and can now succeed once.
        const afterRetry = (await send({ ...read, caseId: c.caseId }, token))!;
        const lostCommand = {
          ...change,
          requestId: crypto.randomUUID(),
          expectedRevision: afterRetry.cases[0]!.revision,
          operation: "status",
          state: "in_progress",
          reason: "triage",
        } as const;
        const lossCount = await auditCount();
        const lostResponse = await handleSupport(
          new Request("https://isolated-api.test/v1/provide/support", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify(lostCommand),
          }),
          env,
          supabaseDashboardTokenVerifier,
          async (...args) => {
            await postgresSupport(...args);
            throw Error("Synthetic post-commit response loss");
          },
          { requestId: crypto.randomUUID() },
          { error: () => undefined },
          new Headers(),
        );
        expect(lostResponse.status).toBe(503);
        const committedCount = await auditCount();
        expect(Number(committedCount)).toBe(Number(lossCount) + 1);
        expect((await send(lostCommand, token))?.cases[0]?.revision).toBe(
          lostCommand.expectedRevision + 1,
        );
        expect(await auditCount()).toBe(committedCount);
        const scan = {
          action: "scan",
          ...scope,
          requestId: crypto.randomUUID(),
          cursor: null,
        } as const;
        const scans = await Promise.all([
          response(scan, token),
          response({ ...scan, requestId: crypto.randomUUID() }, token),
        ]);
        expect(scans.map((r) => r.status)).toEqual([200, 200]);
        expect(
          (
            await sql.query(
              "select kind,source_id,count(*) from private.support_cases where state<>'resolved' and source_id is not null group by restaurant_id,location_id,kind,source_id having count(*)>1",
            )
          ).rowCount,
        ).toBe(0);
        // Existing job writer changes the source concurrently. O1 waits on the source row,
        // reads the committed state and never claims/sends/retries a job itself.
        const job = (
          await sql.query<{ id: string }>(
            "select id from private.email_deliveries where restaurant_id=$1 and location_id=$2 order by id limit 1",
            [restaurantId, locationId],
          )
        ).rows[0];
        expect(job).toBeDefined();
        const writer = new Client({ connectionString: db });
        await writer.connect();
        let concurrent: Promise<Response> | undefined;
        try {
          await writer.query("BEGIN");
          await writer.query(
            "update private.email_deliveries set status='uncertain',lock_token=null,locked_at=null,delivered_at=null where id=$1",
            [job!.id],
          );
          const createSource = {
            action: "create",
            ...scope,
            requestId: crypto.randomUUID(),
            kind: "email_uncertain",
            sourceId: job!.id,
            severity: "high",
            reason: "triage",
          } as const;
          concurrent = response(createSource, token);
          // Event-based proof of the actual DB lock, rather than a timing assumption.
          let blocked = false;
          for (let n = 0; n < 100; n++) {
            const wait = (
              await sql.query<{ n: string }>(
                "select count(*)::text n from pg_stat_activity where wait_event_type='Lock' and query like '%private.support_command%' and pid<>pg_backend_pid()",
              )
            ).rows[0]!.n;
            if (Number(wait) > 0) {
              blocked = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          expect(blocked).toBe(true);
          await writer.query("COMMIT");
          const responseResult = await concurrent;
          expect(responseResult.status).toBe(200);
          const body = await responseResult.json();
          const stateResult = parseSupportState(
            body && typeof body === "object" && "data" in body ? body.data : undefined,
          );
          expect(stateResult?.currentSource?.stateCode).toBe("uncertain");
          expect(stateResult?.currentSource?.canClose).toBe(false);
          expect(
            (
              await sql.query<{ status: string }>(
                "select status from private.email_deliveries where id=$1",
                [job!.id],
              )
            ).rows[0]?.status,
          ).toBe("uncertain");
        } finally {
          await writer.query("ROLLBACK");
          await writer.end();
          await concurrent?.catch(() => undefined);
        }
        // Real provider factor removal exercises the A4 invalidation observation; old signed token stays cryptographically valid but cannot access support.
        expect((await user.auth.mfa.unenroll({ factorId: factor.data.id })).error).toBeNull();
        await send(read, token, 403);
        await send(winner, token, 403);
      } finally {
        await sql.query(
          "drop trigger if exists o1_test_audit_failure on private.support_audit;drop function if exists private.o1_test_audit_failure()",
        );
        // Cases/audit keep pseudonymous UUID attribution. Only synthetic identity/grants are removed.
        expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
        await user.auth.signOut();
        await sql.end();
      }
    }, 60000);
  },
);

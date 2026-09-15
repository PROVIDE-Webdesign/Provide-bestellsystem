import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  createDashboardTokenVerifier,
  dashboardAuthConfigured,
  readBearerToken,
} from "./dashboard-auth.js";

const environment = {
  SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_AUTH_AUDIENCE: "authenticated",
};

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const verifier = createDashboardTokenVerifier(() => keySet);
  const sign = (claims: Record<string, unknown> = {}, expiration = "5m") =>
    new SignJWT({
      aal: "aal2",
      role: "authenticated",
      ...claims,
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject("f1000000-0000-0000-0000-000000000001")
      .setIssuer(environment.SUPABASE_AUTH_ISSUER)
      .setAudience(environment.SUPABASE_AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .sign(privateKey);
  return { verifier, sign };
}

describe("dashboard authentication boundary", () => {
  it("accepts only an exact configured Supabase issuer", () => {
    expect(
      dashboardAuthConfigured({
        SUPABASE_AUTH_ISSUER: "https://project.supabase.co/auth/v1",
        SUPABASE_AUTH_AUDIENCE: "authenticated",
      }),
    ).toBe(true);
    expect(
      dashboardAuthConfigured({
        SUPABASE_AUTH_ISSUER: "https://user:secret@project.supabase.co/auth/v1",
        SUPABASE_AUTH_AUDIENCE: "authenticated",
      }),
    ).toBe(false);
    expect(
      dashboardAuthConfigured({
        SUPABASE_AUTH_ISSUER: "https://project.supabase.co/storage/v1",
        SUPABASE_AUTH_AUDIENCE: "authenticated",
      }),
    ).toBe(false);
  });

  it("extracts only a bounded bearer JWT", () => {
    const token = "a.b.c";
    expect(
      readBearerToken(
        new Request("https://api.test", { headers: { authorization: `Bearer ${token}` } }),
      ),
    ).toBe(token);
    expect(
      readBearerToken(
        new Request("https://api.test", { headers: { authorization: `Basic ${token}` } }),
      ),
    ).toBeUndefined();
    expect(
      readBearerToken(
        new Request("https://api.test", { headers: { authorization: "Bearer not-a-jwt" } }),
      ),
    ).toBeUndefined();
  });

  it("verifies signature, issuer, audience, subject, role and assurance", async () => {
    const { verifier, sign } = await fixture();
    await expect(verifier.verify(await sign(), environment)).resolves.toEqual({
      userId: "f1000000-0000-0000-0000-000000000001",
      aal: "aal2",
    });
    await expect(
      verifier.verify(await sign({ aal: undefined }), environment),
    ).resolves.toMatchObject({ aal: "aal1" });
    await expect(
      verifier.verify(await sign({ role: "service_role" }), environment),
    ).rejects.toThrow();
    await expect(verifier.verify(await sign({ aal: "aal3" }), environment)).rejects.toThrow();
  });

  it("rejects a wrong signature, issuer, audience and expired token", async () => {
    const { verifier, sign } = await fixture();
    const other = await fixture();
    await expect(verifier.verify(await other.sign(), environment)).rejects.toThrow();
    await expect(
      verifier.verify(await sign(), {
        ...environment,
        SUPABASE_AUTH_ISSUER: "https://other.supabase.co/auth/v1",
      }),
    ).rejects.toThrow();
    await expect(
      verifier.verify(await sign(), { ...environment, SUPABASE_AUTH_AUDIENCE: "other" }),
    ).rejects.toThrow();
    await expect(verifier.verify(await sign({}, "0s"), environment)).rejects.toThrow();
  });
});

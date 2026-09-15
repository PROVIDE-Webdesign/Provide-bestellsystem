import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";

export interface DashboardIdentity {
  readonly userId: string;
  readonly aal: "aal1" | "aal2";
}

export interface DashboardAuthEnvironment {
  readonly SUPABASE_AUTH_ISSUER?: string;
  readonly SUPABASE_AUTH_AUDIENCE?: string;
}

export interface DashboardTokenVerifier {
  verify(token: string, environment: DashboardAuthEnvironment): Promise<DashboardIdentity>;
}

export class InvalidDashboardTokenError extends Error {}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
type KeySetProvider = (url: URL) => JWTVerifyGetKey;

function issuerUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith("/auth/v1") ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    )
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function dashboardAuthConfigured(environment: DashboardAuthEnvironment): boolean {
  return Boolean(
    issuerUrl(environment.SUPABASE_AUTH_ISSUER) &&
    environment.SUPABASE_AUTH_AUDIENCE &&
    /^[A-Za-z0-9._:-]{1,120}$/.test(environment.SUPABASE_AUTH_AUDIENCE),
  );
}

export function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 8192) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  return match?.[1];
}

export function createDashboardTokenVerifier(
  provideKeySet: KeySetProvider = (url) => {
    let keySet = keySets.get(url.href);
    if (!keySet) {
      keySet = createRemoteJWKSet(url, { cooldownDuration: 10 * 60 * 1000 });
      keySets.set(url.href, keySet);
    }
    return keySet;
  },
): DashboardTokenVerifier {
  return {
    async verify(token, environment) {
      const issuer = issuerUrl(environment.SUPABASE_AUTH_ISSUER);
      const audience = environment.SUPABASE_AUTH_AUDIENCE;
      if (!issuer || !audience) throw new Error("Dashboard auth is not configured");
      const jwksUrl = new URL(`${issuer.toString().replace(/\/$/, "")}/.well-known/jwks.json`);
      const keySet = provideKeySet(jwksUrl);
      let payload: JWTPayload;
      try {
        const verified = await jwtVerify(token, keySet, {
          algorithms: ["ES256", "RS256"],
          audience,
          issuer: issuer.href.replace(/\/$/, ""),
        });
        payload = verified.payload;
      } catch (error) {
        const code =
          error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (
          [
            "ERR_JOSE_ALG_NOT_ALLOWED",
            "ERR_JWS_INVALID",
            "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
            "ERR_JWT_CLAIM_VALIDATION_FAILED",
            "ERR_JWT_EXPIRED",
            "ERR_JWT_INVALID",
            "ERR_JWKS_NO_MATCHING_KEY",
          ].includes(code)
        )
          throw new InvalidDashboardTokenError();
        throw error;
      }
      if (
        typeof payload.sub !== "string" ||
        !uuidPattern.test(payload.sub) ||
        payload.role !== "authenticated"
      )
        throw new InvalidDashboardTokenError();
      const aal = payload.aal === undefined ? "aal1" : payload.aal;
      if (aal !== "aal1" && aal !== "aal2") throw new InvalidDashboardTokenError();
      return { userId: payload.sub, aal };
    },
  };
}

export const supabaseDashboardTokenVerifier = createDashboardTokenVerifier();

import { type EnvironmentSource, requireUrl, requireValue } from "./internal.js";
import { loadPublicEnvironment, type PublicEnvironment } from "./public.js";

export interface ServerEnvironment extends PublicEnvironment {
  readonly AUTH_SESSION_SECRET: string;
  readonly DATABASE_URL: string;
}

export function loadServerEnvironment(source: EnvironmentSource): ServerEnvironment {
  const publicEnvironment = loadPublicEnvironment(source);
  const sessionSecret = requireValue(source, "AUTH_SESSION_SECRET");

  if (sessionSecret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters");
  }

  return {
    ...publicEnvironment,
    AUTH_SESSION_SECRET: sessionSecret,
    DATABASE_URL: requireUrl(source, "DATABASE_URL", ["postgres:", "postgresql:"]),
  };
}

import { URL } from "node:url";

import { appEnvironments, type AppEnvironment } from "@provide/contracts";

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function requireValue(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function requireAppEnvironment(source: EnvironmentSource): AppEnvironment {
  const value = requireValue(source, "APP_ENV");

  if (!appEnvironments.some((environment) => environment === value)) {
    throw new Error(`Unsupported APP_ENV: ${value}`);
  }

  return value as AppEnvironment;
}

export function requireUrl(
  source: EnvironmentSource,
  name: string,
  protocols: readonly string[],
): string {
  const value = requireValue(source, name);
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Environment variable ${name} must be a valid URL`);
  }

  if (!protocols.includes(url.protocol)) {
    throw new Error(`Environment variable ${name} must use ${protocols.join(" or ")}`);
  }

  return value;
}

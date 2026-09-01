export const appEnvironments = ["development", "test", "preview", "production"] as const;

export type AppEnvironment = (typeof appEnvironments)[number];

export function isAppEnvironment(value: string): value is AppEnvironment {
  return appEnvironments.some((environment) => environment === value);
}

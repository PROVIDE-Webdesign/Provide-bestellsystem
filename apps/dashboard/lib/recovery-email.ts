import { createDashboardBrowserClient } from "./supabase-browser.js";
export const recoveryEmailNotice =
  "Wenn ein bestehendes Konto für diese Adresse wiederhergestellt werden kann, erhältst du eine E-Mail. Bitte auch den Spamordner prüfen.";
type RequestEmail = (email: string, redirectTo: string) => Promise<unknown>;
export async function requestRecoveryEmail(
  email: string,
  origin: string,
  request: RequestEmail = async (value, redirectTo) => {
    const client = createDashboardBrowserClient(false);
    return client?.auth.resetPasswordForEmail(value, { redirectTo });
  },
) {
  try {
    await request(email, new URL("/auth/recovery", origin).href);
  } catch {
    /* All provider outcomes remain neutral. */
  }
  return recoveryEmailNotice;
}

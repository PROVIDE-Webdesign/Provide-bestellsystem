import { it, expect, vi } from "vitest";
import { requestRecoveryEmail, recoveryEmailNotice } from "./recovery-email.js";
it("reveals neither account existence nor provider/rate-limit details", async () => {
  for (const reply of [
    () => Promise.resolve({ data: {}, error: null }),
    () => Promise.resolve({ error: { status: 429, message: "existing identity details" } }),
    () => Promise.reject(Error("provider identity details")),
  ]) {
    const request = vi.fn(reply);
    expect(
      await requestRecoveryEmail("synthetic@example.invalid", "https://dashboard.test", request),
    ).toBe(recoveryEmailNotice);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "synthetic@example.invalid",
      "https://dashboard.test/auth/recovery",
    );
  }
});

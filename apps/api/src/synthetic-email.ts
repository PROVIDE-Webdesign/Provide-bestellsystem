import type { EmailAdapter, EmailAdapterResult, EmailMessage } from "./email-notifications.js";

// Explicitly injected test double; never a provider or default deployment adapter.
export function createSyntheticEmailAdapter() {
  const accepted = new Map<string, { reference: string; fingerprint: string }>();
  let count = 0;
  const adapter: EmailAdapter & { acceptedCount(): number } = {
    configured: true,
    acceptedCount: () => count,
    send(
      command: EmailMessage & { destination: string; idempotencyKey: string },
    ): Promise<EmailAdapterResult> {
      if (!command.destination.endsWith("@example.invalid"))
        return Promise.resolve({ outcome: "permanent_failure", code: "destination_rejected" });
      const fingerprint = JSON.stringify(command);
      const existing = accepted.get(command.idempotencyKey);
      if (existing)
        return Promise.resolve(
          existing.fingerprint === fingerprint
            ? { outcome: "accepted", reference: existing.reference }
            : { outcome: "permanent_failure", code: "content_rejected" },
        );
      const reference = "synthetic-email-" + ++count;
      accepted.set(command.idempotencyKey, { reference, fingerprint });
      return Promise.resolve({ outcome: "accepted", reference });
    },
    lookup(key) {
      const existing = accepted.get(key);
      return Promise.resolve(
        existing
          ? { outcome: "accepted", reference: existing.reference }
          : { outcome: "not_found" },
      );
    },
  };
  return adapter;
}

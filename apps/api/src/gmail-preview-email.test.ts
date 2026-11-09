import { describe, expect, it, vi } from "vitest";
import { createGmailPreviewAdapter } from "./gmail-preview-email.js";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const env = {
  APP_ENV: "preview",
  EMAIL_DISPATCH_ENABLED: "true",
  EMAIL_PREVIEW_GMAIL_ACCOUNT: "example.preview@gmail.com",
  EMAIL_PREVIEW_START_AT: "2026-11-09T03:30:00.000Z",
  EMAIL_GMAIL_APP_PASSWORD: "aaaa bbbb cccc dddd",
};
const message = {
  destination: env.EMAIL_PREVIEW_GMAIL_ACCOUNT,
  idempotencyKey: "email:00000000-0000-4000-8000-000000000001:v1",
  subject: "Test",
  text: "Test",
  html: "<p>Test</p>",
};

describe("Gmail preview email adapter", () => {
  it("requires an explicitly enabled preview with a recipient, start and credential", () => {
    for (const override of [
      { APP_ENV: "production" },
      { EMAIL_DISPATCH_ENABLED: "false" },
      { EMAIL_PREVIEW_GMAIL_ACCOUNT: "nobody@example.invalid" },
      { EMAIL_PREVIEW_START_AT: "yesterday" },
      { EMAIL_GMAIL_APP_PASSWORD: "" },
    ])
      expect(createGmailPreviewAdapter({ ...env, ...override })).toBeUndefined();
  });

  it("refuses a different recipient before SMTP and sends with a stable message ID", async () => {
    sendMail.mockClear();
    const adapter = createGmailPreviewAdapter(env)!;
    expect(adapter.previewScope).toEqual({
      recipient: env.EMAIL_PREVIEW_GMAIL_ACCOUNT,
      createdSince: env.EMAIL_PREVIEW_START_AT,
    });
    expect(await adapter.send({ ...message, destination: "outside@gmail.com" })).toEqual({
      outcome: "permanent_failure",
      code: "destination_rejected",
    });
    expect(sendMail).not.toHaveBeenCalled();
    sendMail.mockResolvedValueOnce({ accepted: [message.destination] });
    expect(await adapter.send(message)).toEqual({
      outcome: "accepted",
      reference: message.idempotencyKey,
    });
    expect(sendMail).toHaveBeenCalledExactlyOnceWith({
      from: { name: "PROVIDE Bestellsystem – Vorschau", address: message.destination },
      to: message.destination,
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId: "<provide-order-00000000-0000-4000-8000-000000000001-v1@gmail.com>",
    });
  });

  it("permits retry only after an explicit temporary refusal", async () => {
    const adapter = createGmailPreviewAdapter(env)!;
    sendMail.mockRejectedValueOnce({ responseCode: 451 });
    expect(await adapter.send(message)).toEqual({
      outcome: "temporary_failure",
      code: "provider_unavailable",
    });
    sendMail.mockRejectedValueOnce({ code: "ETIMEDOUT" });
    const unknown = { outcome: "unknown", code: "provider_timeout" };
    expect(await adapter.send(message)).toEqual(unknown);
    expect(await adapter.lookup(message.idempotencyKey)).toEqual(unknown);
  });
});

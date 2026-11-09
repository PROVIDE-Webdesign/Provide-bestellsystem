import { connect } from "node:tls";
import nodemailer from "nodemailer";
import type { EmailAdapter, EmailPreviewScope } from "./email-notifications.js";

export interface GmailPreviewEnvironment {
  readonly APP_ENV: string;
  readonly EMAIL_DISPATCH_ENABLED?: string;
  readonly EMAIL_PREVIEW_GMAIL_ACCOUNT?: string;
  readonly EMAIL_PREVIEW_START_AT?: string;
  readonly EMAIL_GMAIL_APP_PASSWORD?: string;
}

export function createGmailPreviewAdapter(env: GmailPreviewEnvironment): EmailAdapter | undefined {
  if (env.APP_ENV !== "preview" || env.EMAIL_DISPATCH_ENABLED !== "true") return;

  const recipient = env.EMAIL_PREVIEW_GMAIL_ACCOUNT?.trim().toLowerCase();
  const start = env.EMAIL_PREVIEW_START_AT;
  const password = env.EMAIL_GMAIL_APP_PASSWORD?.replaceAll(" ", "");
  if (
    !recipient ||
    !/^[a-z0-9.]+@gmail\.com$/.test(recipient) ||
    !start ||
    !Number.isFinite(Date.parse(start)) ||
    new Date(start).toISOString() !== start ||
    !password ||
    !/^[a-z0-9]{16}$/i.test(password)
  )
    return;

  const previewScope: EmailPreviewScope = { recipient, createdSince: start };
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: recipient, pass: password },
    // Pass the hostname to the Workers TLS proxy instead of resolving it to an IP in Nodemailer.
    getSocket(_options, callback) {
      const socket = connect({
        host: "smtp.gmail.com",
        servername: "smtp.gmail.com",
        port: 465,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      });
      const timeout = setTimeout(
        () => socket.destroy(new Error("SMTP connection timed out")),
        8_000,
      );
      function onError(error: Error) {
        clearTimeout(timeout);
        callback(error, null);
      }
      socket.once("error", onError);
      socket.once("secureConnect", () => {
        clearTimeout(timeout);
        socket.removeListener("error", onError);
        callback(null, { connection: socket, secured: true });
      });
    },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    configured: true,
    previewScope,
    async send({ destination, idempotencyKey, subject, text, html }) {
      if (destination.toLowerCase() !== recipient)
        return { outcome: "permanent_failure", code: "destination_rejected" };
      const identity = /^email:([a-f0-9-]{36}):v([0-9]+)$/i.exec(idempotencyKey);
      if (!identity) return { outcome: "permanent_failure", code: "content_rejected" };

      try {
        const result = await transport.sendMail({
          from: { name: "PROVIDE Bestellsystem – Vorschau", address: recipient },
          to: recipient,
          subject,
          text,
          html,
          messageId: `<provide-order-${identity[1]}-v${identity[2]}@gmail.com>`,
        });
        return result.accepted.includes(recipient)
          ? { outcome: "accepted", reference: idempotencyKey }
          : { outcome: "unknown", code: "invalid_adapter_result" };
      } catch (error) {
        const failure = error as { readonly code?: string; readonly responseCode?: number } | null;
        const responseCode = failure?.responseCode ?? 0;
        if (responseCode >= 400 && responseCode < 500)
          return { outcome: "temporary_failure", code: "provider_unavailable" };
        if (failure?.code === "EAUTH")
          return { outcome: "temporary_failure", code: "provider_unavailable" };
        if (responseCode >= 500 && responseCode < 600)
          return { outcome: "permanent_failure", code: "content_rejected" };
        return { outcome: "unknown", code: "provider_timeout" };
      }
    },
    lookup() {
      // SMTP has no authoritative lookup. A lost reply must never authorize resending.
      return Promise.resolve({ outcome: "unknown", code: "provider_timeout" });
    },
  };
}

import webpush from "web-push";
import { describe, expect, it, vi } from "vitest";
import { parsePushCommand, sendOrderPush, validPushEndpoint } from "./order-push.js";

const endpoint = "https://fcm.googleapis.com/fcm/send/synthetic";
const config = { ...webpush.generateVAPIDKeys(), subject: "mailto:synthetic@example.invalid" };
const delivery = {
  eventId: "00000000-0000-0000-0000-000000000001",
  subscriptionId: "00000000-0000-0000-0000-000000000002",
  lease: "00000000-0000-0000-0000-000000000003",
  endpoint,
  p256dh: webpush.generateVAPIDKeys().publicKey,
  auth: "AAAAAAAAAAAAAAAAAAAAAA",
};

describe("restaurant Web Push", () => {
  it("accepts known HTTPS providers and refuses URL injection", () => {
    for (const value of [
      endpoint,
      "https://web.push.apple.com/synthetic",
      "https://updates.push.services.mozilla.com/wpush/v2/synthetic",
      "https://wns2-bl2p.notify.windows.com/w/?token=synthetic",
    ])
      expect(validPushEndpoint(value)).toBe(true);
    for (const value of [
      "http://web.push.apple.com/synthetic",
      "https://web.push.apple.com.attacker.invalid/synthetic",
      "https://push.apple.com@localhost/internal",
      "https://web.push.apple.com:8443/synthetic",
      "https://fcm.googleapis.com/admin",
      "https://127.0.0.1/fcm/send/synthetic",
      endpoint + "#unexpected",
    ])
      expect(validPushEndpoint(value)).toBe(false);
  });

  it("validates action and key shape", () => {
    expect(parsePushCommand({ action: "status" })).toEqual({ action: "status", endpoint: "" });
    expect(parsePushCommand({ action: "remove", endpoint, extra: true })).toBeUndefined();
    expect(
      parsePushCommand({ action: "subscribe", endpoint, p256dh: "bad", auth: delivery.auth }),
    ).toBeUndefined();
    expect(
      parsePushCommand({
        action: "subscribe",
        endpoint,
        p256dh: delivery.p256dh,
        auth: delivery.auth,
      }),
    ).toBeDefined();
  });

  it("sends encrypted high-priority push with a stable topic and without redirects", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    await expect(sendOrderPush(delivery, config, provider)).resolves.toBe("sent");
    const [url, request] = provider.mock.calls[0]!;
    const headers = new Headers(request?.headers);
    expect(url).toBe(endpoint);
    expect(request).toMatchObject({ method: "POST", redirect: "manual" });
    expect(headers.get("authorization")).toMatch(/^vapid t=/);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("urgency")).toBe("high");
    expect(headers.get("ttl")).toBe("60");
    expect(headers.get("topic")).toBe("AAAAAAAAAAAAAAAAAAAAAQ");
    expect(request?.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(request?.body as Uint8Array)).not.toContain(delivery.eventId);
  });

  it("does not follow provider redirects or forward credentials to their target", async () => {
    for (const status of [301, 302, 307, 308]) {
      const provider = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, {
            status,
            headers: { location: "https://unexpected.example.invalid/" },
          }),
        );
      await expect(sendOrderPush(delivery, config, provider)).resolves.toBe("retry");
      expect(provider).toHaveBeenCalledTimes(1);
      expect(provider.mock.calls[0]?.[0]).toBe(endpoint);
      expect(provider.mock.calls[0]?.[1]?.redirect).toBe("manual");
    }
  });

  it("drops expired subscriptions and retries transient provider failures", async () => {
    for (const status of [404, 410, 429, 503]) {
      const provider = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
      await expect(sendOrderPush(delivery, config, provider)).resolves.toBe(
        status < 420 ? "gone" : "retry",
      );
    }
    const provider = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(sendOrderPush(delivery, config, provider)).resolves.toBe("retry");
  });
});

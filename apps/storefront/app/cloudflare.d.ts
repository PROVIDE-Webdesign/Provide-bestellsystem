// Runtime module provided by workerd. Secret bindings are consumed only in server routes.
declare module "cloudflare:workers" {
  export const env: {
    readonly APP_ENV?: string;
    readonly PUBLIC_LIVE_ONLINE_PAYMENT_ENABLED?: string;
    readonly PUBLIC_LIVE_CHECKOUT_PRIVACY_URL?: string;
    readonly ASIAN_KITCHEN_DEMO_ENABLED?: string;
    readonly PUBLIC_PICKUP_PREVIEW_SCHEDULE?: string;
    readonly PUBLIC_API_URL?: string;
    readonly CHECKOUT_PROTECTION_ENABLED?: string;
    readonly PUBLIC_CHECKOUT_TURNSTILE_SITE_KEY?: string;
    readonly PUBLIC_ONLINE_PAYMENT_ENABLED?: string;
    readonly PUBLIC_CHECKOUT_PRIVACY_NOTICE_VERSION?: string;
  };
}

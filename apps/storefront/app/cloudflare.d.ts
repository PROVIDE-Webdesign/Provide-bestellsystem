// Runtime module provided by workerd. Secret bindings are consumed only in server routes.
declare module "cloudflare:workers" {
  export const env: {
    readonly PUBLIC_API_URL?: string;
    readonly CHECKOUT_PROTECTION_ENABLED?: string;
    readonly PUBLIC_CHECKOUT_TURNSTILE_SITE_KEY?: string;
    readonly PUBLIC_ONLINE_PAYMENT_ENABLED?: string;
    readonly PUBLIC_CHECKOUT_PRIVACY_NOTICE_VERSION?: string;
  };
}

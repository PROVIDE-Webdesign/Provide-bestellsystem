// Runtime module provided by workerd. Only the public binding used by this app is declared.
declare module "cloudflare:workers" {
  export const env: {
    readonly PUBLIC_API_URL?: string;
    readonly PUBLIC_ONLINE_PAYMENT_ENABLED?: string;
    readonly PUBLIC_CHECKOUT_PRIVACY_NOTICE_VERSION?: string;
  };
}

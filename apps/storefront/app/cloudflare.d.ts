// Runtime module provided by workerd. Only the public binding used by this app is declared.
declare module "cloudflare:workers" {
  export const env: { readonly PUBLIC_API_URL?: string };
}

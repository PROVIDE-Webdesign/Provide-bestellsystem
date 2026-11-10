/** Browser and server writes must agree, including refreshed and PKCE cookies. */
export const dashboardAuthCookieOptions = { secure: true, sameSite: "lax", path: "/" } as const;

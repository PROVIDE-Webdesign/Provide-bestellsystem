/** The provider's default invitation redirect carries a session in the fragment, never a server URL. */
export function readInvitationSessionFragment(
  fragment: string,
): { access_token: string; refresh_token: string } | undefined {
  if (fragment.length > 16000 || !fragment.startsWith("#")) return;
  const p = new URLSearchParams(fragment.slice(1));
  const access = p.get("access_token"),
    refresh = p.get("refresh_token");
  if (
    !access ||
    !refresh ||
    p.getAll("access_token").length !== 1 ||
    p.getAll("refresh_token").length !== 1 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access) ||
    !/^[A-Za-z0-9_-]{8,1024}$/.test(refresh)
  )
    return;
  if (p.get("type") && !["invite", "magiclink"].includes(p.get("type")!)) return;
  return { access_token: access, refresh_token: refresh };
}

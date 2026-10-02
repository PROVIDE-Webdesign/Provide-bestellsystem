import { it, expect } from "vitest";
import { readInvitationSessionFragment } from "./invitation-session.js";
it("accepts only bounded unique provider session fields and ignores role metadata", () => {
  expect(
    readInvitationSessionFragment(
      "#access_token=header.payload.signature&refresh_token=synthetic_refresh&type=invite&role=owner",
    ),
  ).toEqual({ access_token: "header.payload.signature", refresh_token: "synthetic_refresh" });
  expect(
    readInvitationSessionFragment(
      "#access_token=header.payload.signature&access_token=other&refresh_token=synthetic_refresh",
    ),
  ).toBeUndefined();
  expect(
    readInvitationSessionFragment(
      "#access_token=header.payload.signature&refresh_token=synthetic_refresh&type=recovery",
    ),
  ).toBeUndefined();
  expect(readInvitationSessionFragment("#access_token=" + "x".repeat(17000))).toBeUndefined();
});

import { describe, expect, it } from "vitest";

import { readJsonBody } from "./http.js";
import type { RequestBodyError } from "./http.js";

describe("request body boundary", () => {
  it("rejects a missing JSON content type", async () => {
    await expect(
      readJsonBody(new Request("https://api.example.test", { method: "POST" })),
    ).rejects.toMatchObject({
      code: "unsupported_media_type",
      status: 415,
    } satisfies Partial<RequestBodyError>);
  });

  it("rejects malformed JSON", async () => {
    await expect(
      readJsonBody(
        new Request("https://api.example.test", {
          body: "{",
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).rejects.toMatchObject({
      code: "bad_request",
      status: 400,
    } satisfies Partial<RequestBodyError>);
  });
});

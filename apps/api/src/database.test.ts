import { describe, expect, it, vi } from "vitest";
const pg = vi.hoisted(() => {
  const options: Record<string, unknown> = {};
  return { connect: vi.fn(), query: vi.fn(), end: vi.fn(), options };
});
vi.mock("pg", () => ({
  Client: class {
    constructor(options: Record<string, unknown>) {
      pg.options = options;
    }
    connect = pg.connect;
    query = pg.query;
    end = pg.end;
  },
}));
import { probeDatabase } from "./database.js";

describe("bounded database monitor", () => {
  it("sets finite connection and statement deadlines and closes on a simulated timeout", async () => {
    pg.connect.mockResolvedValue(undefined);
    pg.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Query read timeout"));
    pg.end.mockResolvedValue(undefined);
    await expect(probeDatabase("postgresql://synthetic.invalid/provide")).rejects.toThrow(
      "timeout",
    );
    expect(pg.options).toMatchObject({ connectionTimeoutMillis: 3000, query_timeout: 3000 });
    expect(pg.query).toHaveBeenCalledWith("SET LOCAL statement_timeout = '2500ms'");
    expect(pg.end).toHaveBeenCalledOnce();
  });
});

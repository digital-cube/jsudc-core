import { describe, expect, it, vi } from "vitest";
import { UdcClient } from "../src/client.js";
import {
  ACTIONS,
  CapabilitiesSchema,
  filter as f,
  MUTATE_MANY_MAX_IDS,
  MutateManyRequestSchema,
  MutateManyResponseSchema,
  SUPPORTED_OPS,
} from "../src/index.js";

const ok = (req: unknown) => MutateManyRequestSchema.safeParse(req).success;

describe("mutate_many request", () => {
  it("accepts ids, a filter, a filter with except_ids", () => {
    expect(ok({ collection: "c", op: "delete", ids: ["a", "b"] })).toBe(true);
    expect(ok({ collection: "c", op: "update", ids: [], row: { archived: true } })).toBe(true);
    expect(ok({ collection: "c", op: "update", filter: f.eq("s", 1), row: { s: 2 } })).toBe(true);
    expect(ok({ collection: "c", op: "delete", filter: { and: [] }, except_ids: ["x"] })).toBe(
      true,
    );
  });

  it.each([
    ["neither ids nor filter", { collection: "c", op: "delete" }],
    ["both ids and filter", { collection: "c", op: "delete", ids: ["a"], filter: { and: [] } }],
    ["except_ids without filter", { collection: "c", op: "delete", ids: ["a"], except_ids: ["b"] }],
    ["update without a row", { collection: "c", op: "update", ids: ["a"] }],
    ["insert", { collection: "c", op: "insert", ids: ["a"], row: {} }],
    ["an empty id", { collection: "c", op: "delete", ids: [""] }],
    ["a bad filter", { collection: "c", op: "delete", filter: { field: "a", op: "like" } }],
    [
      "too many ids",
      {
        collection: "c",
        op: "delete",
        ids: Array.from({ length: MUTATE_MANY_MAX_IDS + 1 }, String),
      },
    ],
  ])("refuses %s", (_, req) => {
    expect(ok(req)).toBe(false);
  });

  it("answers updated and failed", () => {
    expect(
      MutateManyResponseSchema.safeParse({
        updated: 2,
        failed: [
          { id: "x", code: "not_found", message: "row not found: x" },
          { id: "y", code: "not_found" },
        ],
      }).success,
    ).toBe(true);
    expect(
      MutateManyResponseSchema.safeParse({ updated: 1, failed: [{ id: "x", code: "nope" }] })
        .success,
    ).toBe(false);
  });

  it("is in ACTIONS", () => {
    expect(ACTIONS.mutate_many.request).toBe(MutateManyRequestSchema);
    expect(ACTIONS.mutate_many.response).toBe(MutateManyResponseSchema);
  });
});

describe("capabilities.mutate_many", () => {
  const base = {
    mutate: true,
    subscribe: false,
    total_count: true,
    schema_edit: false,
    config_edit: false,
    reindex: false,
    tree_reparent: false,
    supported_filter_ops: [...SUPPORTED_OPS],
  };

  it("is optional and left absent (read as false)", () => {
    const caps = CapabilitiesSchema.parse(base);
    expect(caps.mutate_many).toBeUndefined();
    expect(CapabilitiesSchema.parse({ ...base, mutate_many: true }).mutate_many).toBe(true);
  });
});

describe("UdcClient.mutateMany", () => {
  it("posts udc/mutate_many and unwraps the answer", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        collection: "mail",
        op: "update",
        filter: f.eq("folder", "inbox"),
        except_ids: ["m3"],
        row: { archived: true },
      });
      return new Response(
        JSON.stringify({ kind: "udc.mutate_many.ok", id: "", payload: { updated: 4, failed: [] } }),
      );
    });
    const client = new UdcClient({
      httpUrl: "",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const res = await client.mutateMany({
      collection: "mail",
      op: "update",
      filter: f.eq("folder", "inbox"),
      except_ids: ["m3"],
      row: { archived: true },
    });
    expect(res).toEqual({ updated: 4, failed: [] });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("/udc/mutate_many");
  });
});

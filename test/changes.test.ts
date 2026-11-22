import { describe, expect, it } from "vitest";
import {
  CapabilitiesSchema,
  CHANGE_OPS,
  ChangeEventSchema,
  ChangesReadySchema,
  SseParser,
  sourcePushesChanges,
} from "../src/index.js";

describe("ChangeEventSchema", () => {
  it("is collection, op and optional ids; the ops are mutate's", () => {
    expect(CHANGE_OPS).toEqual(["insert", "update", "delete"]);
    expect(ChangeEventSchema.parse({ collection: "tasks", op: "insert", ids: ["a"] })).toEqual({
      collection: "tasks",
      op: "insert",
      ids: ["a"],
    });
    expect(ChangeEventSchema.parse({ collection: "tasks", op: "delete" })).toEqual({
      collection: "tasks",
      op: "delete",
    });
    expect(ChangeEventSchema.safeParse({ collection: "tasks", op: "upsert" }).success).toBe(false);
    expect(ChangeEventSchema.safeParse({ collection: "", op: "insert" }).success).toBe(false);
    // No row data travels: the schema keeps none.
    expect(
      ChangeEventSchema.parse({ collection: "t", op: "update", row: { secret: 1 } }),
    ).not.toHaveProperty("row");
    expect(ChangesReadySchema.parse({ collections: ["a"] })).toEqual({ collections: ["a"] });
  });
});

describe("capabilities.changes", () => {
  const base = {
    mutate: true,
    subscribe: false,
    total_count: true,
    schema_edit: false,
    config_edit: false,
    reindex: false,
    tree_reparent: false,
    supported_filter_ops: ["eq"],
  };

  it("is optional; absent means poll", () => {
    expect(CapabilitiesSchema.parse(base).changes).toBeUndefined();
    expect(CapabilitiesSchema.parse({ ...base, changes: true }).changes).toBe(true);
    expect(sourcePushesChanges(CapabilitiesSchema.parse(base))).toBe(false);
    expect(sourcePushesChanges({ changes: true })).toBe(true);
    expect(sourcePushesChanges({ changes: "yes" })).toBe(false);
    expect(sourcePushesChanges(null)).toBe(false);
    expect(sourcePushesChanges(undefined)).toBe(false);
  });
});

describe("SseParser", () => {
  it("parses events, joins data lines, skips comments", () => {
    const p = new SseParser();
    const out = p.push(
      ': heartbeat\n\nretry: 2500\n\nevent: change\ndata: {"a":1}\n\ndata: x\ndata: y\nid: 7\n\n',
    );
    expect(out).toEqual([
      { event: "message", data: "", retry: 2500 },
      { event: "change", data: '{"a":1}' },
      { event: "message", data: "x\ny", id: "7" },
    ]);
  });

  it("survives a split anywhere, including inside \\r\\n", () => {
    const text = 'event: change\r\ndata: {"collection":"t","op":"insert"}\r\n\r\n';
    for (let cut = 1; cut < text.length; cut += 1) {
      const p = new SseParser();
      const out = [...p.push(text.slice(0, cut)), ...p.push(text.slice(cut))];
      expect(out, `cut at ${cut}`).toEqual([
        { event: "change", data: '{"collection":"t","op":"insert"}' },
      ]);
    }
  });

  it("accepts a bare \\r as a line end, a field without a colon, and ignores a bad retry", () => {
    const p = new SseParser();
    expect(p.push("data\rretry: soon\r\r\n")).toEqual([{ event: "message", data: "" }]);
    expect(p.push("event: nothing\n\n")).toEqual([]);
    expect(p.push("id: a\0b\ndata: z\n\n")).toEqual([{ event: "message", data: "z" }]);
  });

  it("holds an unfinished event until its blank line", () => {
    const p = new SseParser();
    expect(p.push("event: change\ndata: 1\n")).toEqual([]);
    expect(p.push("\n")).toEqual([{ event: "change", data: "1" }]);
  });
});

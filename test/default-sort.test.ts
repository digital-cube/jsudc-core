import { describe, expect, it } from "vitest";
import { defaultSortProblems, SchemaDocSchema, ViewConfigSchema } from "../src/index.js";

const schema = SchemaDocSchema.parse({
  version: "1",
  fields: {
    subject: { type: "string" },
    received_at: { type: "datetime" },
    old: { type: "string", deleted: true },
  },
});

describe("ViewConfig default_sort", () => {
  it("is absent unless the view declares it", () => {
    expect(ViewConfigSchema.parse({}).default_sort).toBeUndefined();
  });

  it("parses a list of sort keys, dir optional", () => {
    const view = ViewConfigSchema.parse({
      default_sort: [{ field: "received_at", dir: "desc" }, { field: "subject" }],
    });
    expect(view.default_sort).toEqual([
      { field: "received_at", dir: "desc" },
      { field: "subject" },
    ]);
  });

  it("refuses a direction other than asc / desc and a key without a field", () => {
    expect(
      ViewConfigSchema.safeParse({ default_sort: [{ field: "a", dir: "down" }] }).success,
    ).toBe(false);
    expect(ViewConfigSchema.safeParse({ default_sort: [{ dir: "asc" }] }).success).toBe(false);
  });
});

describe("defaultSortProblems", () => {
  it("is empty when every key names a live field once", () => {
    expect(defaultSortProblems([{ field: "received_at" }, { field: "subject" }], schema)).toEqual(
      [],
    );
  });

  it("names a missing or deleted field and a field named twice, by index", () => {
    expect(
      defaultSortProblems(
        [{ field: "nope" }, { field: "old" }, { field: "subject" }, { field: "subject" }],
        schema,
      ),
    ).toEqual([
      "default_sort[0]: nope is not a field of the schema",
      "default_sort[1]: old is not a field of the schema",
      "default_sort[3]: subject is named twice",
    ]);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateFilter,
  FieldDefSchema,
  isLookupType,
  isRowIdField,
  isStorableType,
  lookupFieldProblems,
  lookupKeyOf,
  lookupKeysFilter,
  lookupOf,
  lookupProblems,
  type Row,
  rowLinkCondition,
  rowLinkProblems,
  rowLinkValue,
  type SchemaDoc,
  SchemaDocSchema,
  ViewConfigSchema,
  validateRow,
} from "../src/index.js";

const read = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");

const schemaOf = (fields: Record<string, unknown>): SchemaDoc =>
  SchemaDocSchema.parse({ version: "v1", fields });

const boards = schemaOf({ name: { type: "string" }, key: { type: "string" } });
const org = schemaOf({
  name: { type: "string" },
  title: { type: "string" },
  gone: { type: "string", deleted: true },
});
const targets: Record<string, SchemaDoc> = { boards, org };
const lookupTarget = (name: string) => targets[name];

const row = (id: string, data: Record<string, unknown> = {}): Row => ({
  __meta: { id, version: 1 },
  ...data,
});

describe("LookupDef in FieldDefSchema", () => {
  it("parses the nested form", () => {
    const def = FieldDefSchema.parse({
      type: "lookup_array",
      lookup: { collection: "org", label_field: "name", extra_fields: ["title"] },
    });
    expect(def.lookup).toEqual({ collection: "org", label_field: "name", extra_fields: ["title"] });
  });

  it("normalises the flat udc-py form and drops ref / label_field", () => {
    const def = FieldDefSchema.parse({
      type: "lookup",
      ref: "boards",
      label_field: "name",
      required: true,
    });
    expect(def).toEqual({
      type: "lookup",
      required: true,
      lookup: { collection: "boards", label_field: "name" },
    });
  });

  it("keeps the nested form when both are given", () => {
    const def = FieldDefSchema.parse({
      type: "lookup",
      ref: "x",
      label_field: "y",
      lookup: { collection: "boards", label_field: "name" },
    });
    expect(def.lookup?.collection).toBe("boards");
  });

  it("leaves a dc-lookups path (ref, no label_field) as it is", () => {
    const schema = SchemaDocSchema.parse(JSON.parse(read("books/schema.json")));
    expect(schema.fields.genre).toMatchObject({ type: "lookup", ref: "Books.Genre" });
    expect(schema.fields.genre?.lookup).toBeUndefined();
  });

  it("leaves a relation in the flat form (level 2)", () => {
    const def = FieldDefSchema.parse({ type: "relation", ref: "boards", label_field: "name" });
    expect(def).toEqual({ type: "relation", ref: "boards", label_field: "name" });
  });

  it("refuses a lookup block on another type and a bad block", () => {
    expect(() =>
      FieldDefSchema.parse({ type: "string", lookup: { collection: "a", label_field: "b" } }),
    ).toThrow(/only for lookup/);
    expect(() => FieldDefSchema.parse({ type: "lookup", lookup: { collection: "a" } })).toThrow();
    expect(() =>
      FieldDefSchema.parse({ type: "lookup", lookup: { collection: "", label_field: "b" } }),
    ).toThrow();
    expect(() =>
      FieldDefSchema.parse({
        type: "lookup",
        lookup: { collection: "a", label_field: "b", key_field: "Not-A-Name" },
      }),
    ).toThrow();
  });

  it("knows the lookup and storable types", () => {
    expect(isLookupType("lookup")).toBe(true);
    expect(isLookupType("lookup_array")).toBe(true);
    expect(isLookupType("relation")).toBe(false);
    expect(isStorableType("lookup_array")).toBe(true);
    expect(isStorableType("integer")).toBe(true);
    expect(isStorableType("relation")).toBe(false);
    expect(lookupOf(undefined)).toBeUndefined();
    expect(lookupOf({ type: "string" })).toBeUndefined();
  });
});

describe("lookup values", () => {
  const schema = schemaOf({
    board_id: { type: "lookup", length: 5, lookup: { collection: "boards", label_field: "name" } },
    assignees: { type: "lookup_array", lookup: { collection: "org", label_field: "name" } },
  });
  const problems = (data: Record<string, unknown>) =>
    validateRow(schema, data, { mode: "patch" }).map((p) => p.field);

  it("accepts a string or an integer key, and lists of them", () => {
    expect(problems({ board_id: "abc" })).toEqual([]);
    expect(problems({ board_id: 7 })).toEqual([]);
    expect(problems({ assignees: ["a", 2] })).toEqual([]);
    expect(problems({ assignees: [] })).toEqual([]);
  });

  it("refuses anything else", () => {
    expect(problems({ board_id: 1.5 })).toEqual(["board_id"]);
    expect(problems({ board_id: true })).toEqual(["board_id"]);
    expect(problems({ board_id: ["a"] })).toEqual(["board_id"]);
    expect(problems({ board_id: "toolong" })).toEqual(["board_id"]);
    expect(problems({ assignees: "a" })).toEqual(["assignees"]);
    expect(problems({ assignees: [{ id: 1 }] })).toEqual(["assignees"]);
  });

  it("filters an array of keys by any member", () => {
    const r = { assignees: ["a", 2] };
    expect(evaluateFilter({ field: "assignees", op: "in", value: ["2"] }, r)).toBe(true);
    expect(evaluateFilter({ field: "assignees", op: "not_in", value: ["a"] }, r)).toBe(false);
    expect(evaluateFilter({ field: "assignees", op: "not_in", value: ["z"] }, r)).toBe(true);
  });
});

describe("keys and links", () => {
  it("reads the key from the id or from key_field", () => {
    expect(lookupKeyOf(row("u1"), { collection: "boards", label_field: "name" })).toBe("u1");
    expect(
      lookupKeyOf(row("u1", { key: "ROA" }), {
        collection: "boards",
        label_field: "name",
        key_field: "key",
      }),
    ).toBe("ROA");
  });

  it("builds the in-filter over the key field", () => {
    expect(lookupKeysFilter({ collection: "boards", label_field: "name" }, ["a", "b"])).toEqual({
      field: "id",
      op: "in",
      value: ["a", "b"],
    });
    expect(
      lookupKeysFilter({ collection: "boards", label_field: "name", key_field: "key" }, ["A"]),
    ).toEqual({ field: "key", op: "in", value: ["A"] });
  });

  it("reads id as the row id unless the schema stores an id", () => {
    expect(isRowIdField(boards, "id")).toBe(true);
    expect(isRowIdField(boards, "name")).toBe(false);
    expect(isRowIdField(schemaOf({ id: { type: "integer" } }), "id")).toBe(false);
    expect(isRowIdField(schemaOf({ id: { type: "integer", deleted: true } }), "id")).toBe(true);
  });

  it("takes a row_link value from a field or the row id", () => {
    const link = { collection: "tickets", filter: { field: "board_id", value_from: "id" } };
    expect(rowLinkValue(row("b1"), link)).toBe("b1");
    expect(rowLinkCondition(row("b1"), link)).toEqual({ field: "board_id", op: "eq", value: "b1" });
    const byKey = { collection: "tickets", filter: { field: "board_key", value_from: "key" } };
    expect(rowLinkValue(row("b1", { key: "ROA" }), byKey)).toBe("ROA");
  });
});

describe("lookupProblems", () => {
  it("passes a lookup whose names exist", () => {
    const schema = schemaOf({
      board_id: { type: "lookup", ref: "boards", label_field: "name" },
      assignees: {
        type: "lookup_array",
        lookup: {
          collection: "org",
          label_field: "name",
          extra_fields: ["title"],
          key_field: "id",
        },
      },
      plain: { type: "string" },
      old: { type: "lookup", deleted: true },
    });
    expect(lookupProblems("tickets", schema, lookupTarget)).toEqual([]);
  });

  it("names every missing piece", () => {
    const schema = schemaOf({
      a: { type: "lookup", lookup: { collection: "nope", label_field: "name" } },
      b: {
        type: "lookup",
        lookup: {
          collection: "org",
          label_field: "label",
          key_field: "code",
          extra_fields: ["title", "gone"],
        },
      },
      c: { type: "lookup", ref: "Books.Genre" },
    });
    expect(lookupProblems("tickets", schema, lookupTarget)).toEqual([
      "tickets.a: lookup target nope is not a served collection",
      "tickets.b: lookup target org has no field label",
      "tickets.b: lookup target org has no field code",
      "tickets.b: lookup target org has no field gone",
      "tickets.c: a lookup field needs lookup: {collection, label_field}",
    ]);
    expect(lookupFieldProblems("t", "x", { type: "string" }, lookupTarget)).toEqual([]);
  });
});

describe("row_link", () => {
  const tickets = schemaOf({ board_id: { type: "lookup", ref: "boards", label_field: "name" } });
  const all: Record<string, SchemaDoc> = { boards, tickets };

  it("parses in a view", () => {
    const view = ViewConfigSchema.parse({
      row_link: { collection: "tickets", filter: { field: "board_id", value_from: "id" } },
    });
    expect(view.row_link?.filter.value_from).toBe("id");
    expect(() => ViewConfigSchema.parse({ row_link: { collection: "tickets" } })).toThrow();
    expect(() =>
      ViewConfigSchema.parse({
        row_link: { collection: "tickets", filter: { field: "Bad", value_from: "id" } },
      }),
    ).toThrow();
  });

  it("checks both ends", () => {
    const ok = { collection: "tickets", filter: { field: "board_id", value_from: "id" } };
    expect(rowLinkProblems("boards", ok, boards, (n) => all[n])).toEqual([]);
    const byKey = { collection: "tickets", filter: { field: "board_id", value_from: "key" } };
    expect(rowLinkProblems("boards", byKey, boards, (n) => all[n])).toEqual([]);
    expect(
      rowLinkProblems(
        "boards",
        { collection: "nope", filter: { field: "x", value_from: "colour" } },
        boards,
        (n) => all[n],
      ),
    ).toEqual([
      "boards.row_link: nope is not a served collection",
      "boards.row_link: value_from colour is neither id nor a field of boards",
    ]);
    expect(
      rowLinkProblems(
        "boards",
        { collection: "tickets", filter: { field: "bucket_id", value_from: "id" } },
        boards,
        (n) => all[n],
      ),
    ).toEqual(["boards.row_link: tickets has no field bucket_id"]);
  });
});

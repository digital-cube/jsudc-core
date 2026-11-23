import { describe, expect, it } from "vitest";
import {
  ColumnConfigSchema,
  DescribeResponseSchema,
  SortableSchema,
  sortableField,
} from "../src/index.js";

const base = {
  collection: "mail_messages",
  capabilities: {
    mutate: false,
    subscribe: false,
    total_count: true,
    schema_edit: false,
    config_edit: false,
    reindex: false,
    tree_reparent: false,
    supported_filter_ops: [],
  },
  source_kind: "postgres_table",
  schema: { collection: "mail_messages", version: "v1", fields: {}, field_order: [] },
  view: {},
  filterable: { fields: [] },
};

describe("the fields a source sorts on", () => {
  it("parses describe.sortable and leaves it out by default", () => {
    const withIt = DescribeResponseSchema.parse({ ...base, sortable: { fields: ["server_uid"] } });
    expect(withIt.sortable).toEqual({ fields: ["server_uid"] });
    expect(DescribeResponseSchema.parse(base).sortable).toBeUndefined();
  });

  it("refuses a sortable without a field list or with an empty name", () => {
    expect(SortableSchema.safeParse({}).success).toBe(false);
    expect(SortableSchema.safeParse({ fields: [""] }).success).toBe(false);
    expect(SortableSchema.parse({ fields: [] })).toEqual({ fields: [] });
  });

  it("sortableField: a listed field, or any field when describe does not say", () => {
    const listed = { sortable: { fields: ["server_uid"] } };
    expect(sortableField(listed, "server_uid")).toBe(true);
    expect(sortableField(listed, "subject")).toBe(false);
    expect(sortableField({ sortable: { fields: [] } }, "subject")).toBe(false);
    expect(sortableField({}, "subject")).toBe(true);
  });

  it("parses sortable: false on a column config", () => {
    expect(ColumnConfigSchema.parse({ field: "subject", sortable: false })).toEqual({
      field: "subject",
      sortable: false,
    });
    expect(ColumnConfigSchema.safeParse({ field: "a", sortable: "no" }).success).toBe(false);
  });
});

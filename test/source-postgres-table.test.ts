import { describe, expect, it } from "vitest";
import {
  parseSourceConfig,
  SOURCE_KINDS,
  SourceConfigSchema,
  sourceGroup,
  TABLE_ID_TYPES,
} from "../src/index.js";

describe("SourceConfig: postgres_table", () => {
  it("is a kind of the database group", () => {
    expect(SOURCE_KINDS).toContain("postgres_table");
    expect(sourceGroup("postgres_table")).toBe("database");
    expect(TABLE_ID_TYPES).toEqual(["uuid", "text", "integer"]);
  });

  it("fills the defaults: id column id, a uuid id, no column map, total_count on", () => {
    expect(parseSourceConfig({ kind: "postgres_table" })).toEqual({
      kind: "postgres_table",
      options: { id_column: "id", id_type: "uuid", columns: {}, total_count: true },
    });
  });

  it("reads a flat file with every option", () => {
    const cfg = parseSourceConfig({
      kind: "postgres_table",
      table: "message",
      id_column: "message_id",
      id_type: "integer",
      version_column: "row_version",
      columns: { subject: "subject_line", sent_at: "sent" },
      total_count: false,
    });
    expect(cfg).toEqual({
      kind: "postgres_table",
      options: {
        table: "message",
        id_column: "message_id",
        id_type: "integer",
        version_column: "row_version",
        columns: { subject: "subject_line", sent_at: "sent" },
        total_count: false,
      },
    });
  });

  it("refuses anything but an identifier where a table or column name goes", () => {
    const ok = (options: object) =>
      SourceConfigSchema.safeParse({ kind: "postgres_table", options }).success;
    expect(ok({ table: "message" })).toBe(true);
    expect(ok({ table: "message; drop table x" })).toBe(false);
    expect(ok({ table: "Message" })).toBe(false);
    expect(ok({ table: "public.message" })).toBe(false);
    expect(ok({ id_column: "id::text" })).toBe(false);
    expect(ok({ version_column: "(version)" })).toBe(false);
    expect(ok({ columns: { subject: "lower(subject)" } })).toBe(false);
    expect(ok({ columns: { Subject: "subject" } })).toBe(false);
    expect(ok({ id_type: "bigint" })).toBe(false);
    expect(ok({ total_count: "no" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SQLITE_DATABASE,
  parseSourceConfig,
  SOURCE_KINDS,
  SourceConfigSchema,
  sourceGroup,
} from "../src/index.js";

describe("SourceConfig: sqlite_table", () => {
  it("is a kind of the database group", () => {
    expect(SOURCE_KINDS).toContain("sqlite_table");
    expect(sourceGroup("sqlite_table")).toBe("database");
  });

  it("fills the defaults of postgres_table and the database main", () => {
    expect(DEFAULT_SQLITE_DATABASE).toBe("main");
    expect(parseSourceConfig({ kind: "sqlite_table" })).toEqual({
      kind: "sqlite_table",
      options: {
        id_column: "id",
        id_type: "uuid",
        columns: {},
        total_count: true,
        database: "main",
      },
    });
  });

  it("reads a flat file with every option", () => {
    expect(
      parseSourceConfig({
        kind: "sqlite_table",
        database: "vault",
        table: "note",
        id_column: "note_id",
        id_type: "text",
        version_column: "row_version",
        columns: { title: "title_text" },
        total_count: false,
      }),
    ).toEqual({
      kind: "sqlite_table",
      options: {
        database: "vault",
        table: "note",
        id_column: "note_id",
        id_type: "text",
        version_column: "row_version",
        columns: { title: "title_text" },
        total_count: false,
      },
    });
  });

  it("refuses anything but an identifier for the database, a table or a column", () => {
    const ok = (options: object) =>
      SourceConfigSchema.safeParse({ kind: "sqlite_table", options }).success;
    expect(ok({ database: "vault_2" })).toBe(true);
    expect(ok({ database: "/var/data/vault.db" })).toBe(false);
    expect(ok({ database: "" })).toBe(false);
    expect(ok({ table: "note; drop table x" })).toBe(false);
    expect(ok({ table: "main.note" })).toBe(false);
    expect(ok({ columns: { title: "lower(title)" } })).toBe(false);
    expect(ok({ id_type: "blob" })).toBe(false);
  });
});

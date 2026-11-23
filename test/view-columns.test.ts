import { describe, expect, it } from "vitest";
import { COLUMNS_MODES, ColumnConfigSchema, ViewConfigSchema } from "../src/index.js";

describe("a column left out of the table", () => {
  it("parses hidden: true on a column config", () => {
    expect(ColumnConfigSchema.parse({ field: "folder_id", hidden: true })).toEqual({
      field: "folder_id",
      hidden: true,
    });
  });

  it("refuses a hidden that is not a boolean", () => {
    expect(ColumnConfigSchema.safeParse({ field: "a", hidden: "yes" }).success).toBe(false);
  });

  it("parses columns_mode listed and all, and leaves it out by default", () => {
    expect(COLUMNS_MODES).toEqual(["all", "listed"]);
    expect(ViewConfigSchema.parse({ columns_mode: "listed" }).columns_mode).toBe("listed");
    expect(ViewConfigSchema.parse({ columns_mode: "all" }).columns_mode).toBe("all");
    expect(ViewConfigSchema.parse({}).columns_mode).toBeUndefined();
    expect(ViewConfigSchema.safeParse({ columns_mode: "some" }).success).toBe(false);
  });
});

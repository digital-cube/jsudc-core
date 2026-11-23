import { describe, expect, it } from "vitest";
import {
  COLUMN_WIDTH_FILL,
  ColumnConfigSchema,
  isFillColumn,
  ViewConfigSchema,
} from "../src/index.js";

describe("ColumnConfig width: fill, grow, min_width, hide_below", () => {
  it("parses a column exactly as before when it sets none of them", () => {
    const c = ColumnConfigSchema.parse({ field: "from", width: 210 });
    expect(c).toEqual({ field: "from", width: 210 });
    expect(isFillColumn(c)).toBe(false);
  });

  it("takes width: fill with grow and min_width", () => {
    const c = ColumnConfigSchema.parse({
      field: "subject",
      width: "fill",
      grow: 2,
      min_width: 240,
    });
    expect(c).toEqual({ field: "subject", width: COLUMN_WIDTH_FILL, grow: 2, min_width: 240 });
    expect(isFillColumn(c)).toBe(true);
  });

  it("takes hide_below on any column", () => {
    expect(
      ColumnConfigSchema.parse({ field: "from", width: 210, hide_below: 600 }).hide_below,
    ).toBe(600);
    expect(ColumnConfigSchema.parse({ field: "from", hide_below: 600 }).hide_below).toBe(600);
  });

  it("refuses a width word other than fill and non-positive sizes", () => {
    expect(ColumnConfigSchema.safeParse({ field: "a", width: "auto" }).success).toBe(false);
    expect(ColumnConfigSchema.safeParse({ field: "a", width: "fill", min_width: 0 }).success).toBe(
      false,
    );
    expect(ColumnConfigSchema.safeParse({ field: "a", width: "fill", grow: -1 }).success).toBe(
      false,
    );
    expect(ColumnConfigSchema.safeParse({ field: "a", hide_below: 0 }).success).toBe(false);
  });

  it("refuses grow or min_width on a column that does not fill", () => {
    const fixed = ColumnConfigSchema.safeParse({ field: "from", width: 210, min_width: 100 });
    expect(fixed.success).toBe(false);
    expect(fixed.error?.issues[0]?.path).toEqual(["min_width"]);
    expect(fixed.error?.issues[0]?.message).toMatch(/column from has width: 210/);
    const none = ColumnConfigSchema.safeParse({ field: "from", grow: 1 });
    expect(none.success).toBe(false);
    expect(none.error?.issues[0]?.message).toMatch(/column from has no width/);
  });

  it("parses inside a view: the webmail list of the ticket", () => {
    const view = ViewConfigSchema.parse({
      columns: [
        { field: "from", width: 210, hide_below: 560 },
        { field: "subject", width: "fill", min_width: 240 },
        { field: "date", width: 84, align: "right" },
      ],
    });
    expect(view.columns.map((c) => c.width)).toEqual([210, "fill", 84]);
    expect(view.default_column_width).toBe(160);
  });
});

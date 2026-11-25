import { describe, expect, it } from "vitest";
import { ActionDefSchema, PreviewConfigSchema, ViewConfigSchema } from "../src/index.js";

describe("row_actions_display", () => {
  it.each(["inline", "menu", "hover"] as const)("accepts %s", (display) => {
    expect(ViewConfigSchema.parse({ row_actions_display: display }).row_actions_display).toBe(
      display,
    );
  });

  it("is optional", () => {
    expect(ViewConfigSchema.parse({}).row_actions_display).toBeUndefined();
  });

  it("rejects an unknown display", () => {
    const r = ViewConfigSchema.safeParse({ row_actions_display: "popover" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["row_actions_display"]);
  });
});

describe("row_actions_max", () => {
  it("accepts a positive integer", () => {
    expect(ViewConfigSchema.parse({ row_actions_max: 3 }).row_actions_max).toBe(3);
  });

  it("is optional and has no default in the schema (the renderer's default is 4)", () => {
    expect(ViewConfigSchema.parse({})).not.toHaveProperty("row_actions_max");
  });

  it.each([0, -1, 2.5, "3"])("rejects %s", (value) => {
    const r = ViewConfigSchema.safeParse({ row_actions_max: value });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["row_actions_max"]);
  });
});

describe("ActionDef placement", () => {
  it.each(["bar", "menu"] as const)("accepts %s", (placement) => {
    expect(ActionDefSchema.parse({ kind: "archive", placement }).placement).toBe(placement);
  });

  it("is absent by default (the renderer reads absent as bar)", () => {
    expect(ActionDefSchema.parse({ kind: "archive" })).not.toHaveProperty("placement");
  });

  it("rejects an unknown placement, in a row action and in a bulk action", () => {
    expect(ActionDefSchema.safeParse({ kind: "archive", placement: "toolbar" }).success).toBe(
      false,
    );
    const r = ViewConfigSchema.safeParse({
      bulk_actions: [{ kind: "archive", placement: "drawer" }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["bulk_actions", 0, "placement"]);
  });

  it("leaves the preview's placement as it was", () => {
    expect(PreviewConfigSchema.parse({ placement: "right_drawer" }).placement).toBe("right_drawer");
    expect(PreviewConfigSchema.safeParse({ placement: "bar" }).success).toBe(false);
  });
});

describe("a 0.8.0 view", () => {
  const view080 = {
    default_renderer: "table",
    available_renderers: ["table", "cards"],
    columns: [{ field: "subject" }, { field: "received_at" }],
    row_actions: ["archive", "delete"],
    row_action_defs: [
      { kind: "archive", label: "Archive", icon: "archive", when: true, set: { archived: true } },
      { kind: "delete", label: "Delete", variant: "destructive" },
    ],
    bulk_actions: [{ kind: "archive", label: "Archive" }],
    row_actions_display: "menu",
    preview: { placement: "modal" },
  } as const;

  it("parses to the same output it had before the new keys", () => {
    const out = ViewConfigSchema.parse(view080);
    expect(out).not.toHaveProperty("row_actions_max");
    expect(out.row_action_defs?.every((d) => !("placement" in d))).toBe(true);
    expect(out).toMatchInlineSnapshot(`
      {
        "available_renderers": [
          "table",
          "cards",
        ],
        "bulk_actions": [
          {
            "kind": "archive",
            "label": "Archive",
          },
        ],
        "columns": [
          {
            "field": "subject",
          },
          {
            "field": "received_at",
          },
        ],
        "default_column_width": 160,
        "default_renderer": "table",
        "page_size_default": 50,
        "pagination": "infinite",
        "preview": {
          "placement": "modal",
        },
        "row_action_defs": [
          {
            "icon": "archive",
            "kind": "archive",
            "label": "Archive",
            "set": {
              "archived": true,
            },
            "when": true,
          },
          {
            "kind": "delete",
            "label": "Delete",
            "variant": "destructive",
          },
        ],
        "row_actions": [
          "archive",
          "delete",
        ],
        "row_actions_display": "menu",
      }
    `);
  });
});

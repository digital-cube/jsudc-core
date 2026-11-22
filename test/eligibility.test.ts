import { describe, expect, it } from "vitest";
import {
  ActionDefSchema,
  actionConfirms,
  actionServerName,
  filter as f,
  isActionEligible,
  isActionEligibleForAll,
  ViewConfigSchema,
} from "../src/index.js";

const row = (fields: Record<string, unknown>, state?: Record<string, unknown>) => ({
  __meta: { id: "r", version: 1, ...(state ? { state } : {}) },
  ...fields,
});

describe("isActionEligible", () => {
  it("is always eligible without when", () => {
    expect(isActionEligible({}, row({}))).toBe(true);
  });

  it("takes a boolean when as it is", () => {
    expect(isActionEligible({ when: true }, row({}))).toBe(true);
    expect(isActionEligible({ when: false }, row({}))).toBe(false);
  });

  it("evaluates a filter against the row's fields when there is no __meta.state", () => {
    const def = { when: f.eq("archived", false) };
    expect(isActionEligible(def, row({ archived: false }))).toBe(true);
    expect(isActionEligible(def, row({ archived: true }))).toBe(false);
  });

  it("evaluates a filter against __meta.state when the source provides one", () => {
    const def = { when: f.eq("status", "draft") };
    // The row's own field says otherwise: the state wins.
    expect(isActionEligible(def, row({ status: "sent" }, { status: "draft" }))).toBe(true);
    expect(isActionEligible(def, row({ status: "draft" }, { status: "sent" }))).toBe(false);
  });

  it("ignores a __meta.state that is not an object", () => {
    const r = { __meta: { id: "r", version: 1, state: "draft" }, status: "draft" };
    expect(isActionEligible({ when: f.eq("status", "draft") }, r)).toBe(true);
  });

  it("is ineligible for a filter it cannot evaluate", () => {
    const bad = { when: { field: "n", op: "between", value: [1] } } as never;
    expect(isActionEligible(bad, row({ n: 1 }))).toBe(false);
  });
});

describe("isActionEligibleForAll", () => {
  const def = { when: f.eq("archived", false) };

  it("holds only when it holds for every row", () => {
    expect(isActionEligibleForAll(def, [row({ archived: false }), row({ archived: false })])).toBe(
      true,
    );
    expect(isActionEligibleForAll(def, [row({ archived: false }), row({ archived: true })])).toBe(
      false,
    );
  });

  it("mixes rows with and without state", () => {
    const rows = [row({ archived: true }, { archived: false }), row({ archived: false })];
    expect(isActionEligibleForAll(def, rows)).toBe(true);
  });

  it("is false for an empty selection, and follows a boolean when", () => {
    expect(isActionEligibleForAll({}, [])).toBe(false);
    expect(isActionEligibleForAll({ when: true }, [row({})])).toBe(true);
    expect(isActionEligibleForAll({ when: false }, [row({})])).toBe(false);
  });
});

describe("ActionDef set / action / confirm", () => {
  it("parses the new keys, typed", () => {
    const def = ActionDefSchema.parse({
      kind: "archive",
      label: "Archive",
      set: { archived: true },
      action: "mail.archive_thread",
      confirm: "Archive the selected threads?",
    });
    expect(def.set).toEqual({ archived: true });
    expect(actionServerName(def)).toBe("mail.archive_thread");
    expect(actionConfirms(def)).toBe(true);
  });

  it("defaults: the server action is the kind, confirm only for delete", () => {
    expect(actionServerName({ kind: "archive" })).toBe("archive");
    expect(actionConfirms({ kind: "archive" })).toBe(false);
    expect(actionConfirms({ kind: "delete" })).toBe(true);
    expect(actionConfirms({ kind: "delete", confirm: false })).toBe(false);
    expect(actionConfirms({ kind: "archive", confirm: true })).toBe(true);
  });

  it("refuses badly typed keys", () => {
    expect(ActionDefSchema.safeParse({ kind: "a", set: [1] }).success).toBe(false);
    expect(ActionDefSchema.safeParse({ kind: "a", action: "" }).success).toBe(false);
    expect(ActionDefSchema.safeParse({ kind: "a", confirm: 1 }).success).toBe(false);
  });

  it("goes through a view's bulk_actions", () => {
    const view = ViewConfigSchema.parse({
      bulk_actions: [{ kind: "archive", set: { archived: true }, when: f.eq("archived", false) }],
    });
    expect(view.bulk_actions?.[0]?.set).toEqual({ archived: true });
  });
});

import { evaluateFilter } from "./evaluate.js";
import type { ActionDef } from "./view.js";

/** The part of an `ActionDef` eligibility reads. */
export type ActionWhen = Pick<ActionDef, "when">;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * What a `when` filter is evaluated against: `row.__meta.state` when the
 * source provides one (udc-py's convention, an object of state flags), else
 * the row's own fields.
 */
export function eligibilitySubject(row: Record<string, unknown>): Record<string, unknown> {
  const meta = row.__meta;
  const state = isPlainObject(meta) ? meta.state : undefined;
  return isPlainObject(state) ? state : row;
}

/**
 * Whether the action may run on `row`. `when` absent: always. A boolean: as
 * it is. A filter node: `evaluateFilter` against `row.__meta.state` when the
 * row carries one, else against the row's fields. A filter `evaluateFilter`
 * cannot evaluate (an unknown op, a malformed `in`) makes the action
 * ineligible rather than throwing while a row is drawn.
 */
export function isActionEligible(def: ActionWhen, row: Record<string, unknown>): boolean {
  const when = def.when;
  if (when === undefined) return true;
  if (typeof when === "boolean") return when;
  try {
    return evaluateFilter(when, eligibilitySubject(row));
  } catch {
    return false;
  }
}

/**
 * Whether the action may run on every row of a selection: `isActionEligible`
 * holds for each of them. An empty selection has nothing to run on: `false`.
 */
export function isActionEligibleForAll(
  def: ActionWhen,
  rows: readonly Record<string, unknown>[],
): boolean {
  return rows.length > 0 && rows.every((row) => isActionEligible(def, row));
}

/** The server action that runs `def`: its `action`, else its `kind`. */
export function actionServerName(def: Pick<ActionDef, "kind" | "action">): string {
  return def.action ?? def.kind;
}

/** Whether to ask before running `def`: its `confirm` (a question counts as yes), else only for `delete`. */
export function actionConfirms(def: Pick<ActionDef, "kind" | "confirm">): boolean {
  if (def.confirm === undefined) return def.kind === "delete";
  return def.confirm !== false;
}

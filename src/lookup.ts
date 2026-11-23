import type { Condition } from "./filter.js";
import type { Row } from "./row.js";
import { type FieldDef, isLookupType, type LookupDef, type SchemaDoc } from "./schema.js";
import type { RowLink } from "./view.js";

function live(schema: Pick<SchemaDoc, "fields">, name: string): FieldDef | undefined {
  const def = Object.hasOwn(schema.fields, name) ? schema.fields[name] : undefined;
  return def && !def.deleted ? def : undefined;
}

/** `value_from: id` reads the row id, which lives in `__meta`, not among the fields. */
export const ROW_ID = "id";

/** The lookup block of a field, or `undefined` for a field that is no lookup or names no target. */
export function lookupOf(def: FieldDef | undefined): LookupDef | undefined {
  return def && isLookupType(def.type) ? def.lookup : undefined;
}

/** The field of the target a lookup key is matched against; `id` means `__meta.id`. */
export function lookupKeyField(lookup: LookupDef): string {
  return lookup.key_field ?? ROW_ID;
}

/** The key a target row answers to: its `key_field`, or its id. */
export function lookupKeyOf(row: Row, lookup: LookupDef): unknown {
  const field = lookupKeyField(lookup);
  return field === ROW_ID && !Object.hasOwn(row, ROW_ID) ? row.__meta.id : row[field];
}

/**
 * Whether a filter condition on `field` means the row id: the field is `id`
 * and the schema has no live field of that name (a stored field wins). Every
 * jsudc source answers `eq`, `neq`, `in`, `not_in`, `is_null` and
 * `is_not_null` on it, so a lookup by id and a `row_link` with
 * `value_from: id` need no stored copy of the id.
 */
export function isRowIdField(schema: Pick<SchemaDoc, "fields">, field: string): boolean {
  return field === ROW_ID && !live(schema, ROW_ID);
}

/**
 * The filter that selects the target rows of a set of keys: `in` over the
 * key field. Without a `key_field` that is `id`, which every jsudc source
 * reads as the row id when the schema has no live field of that name
 * (`ROW_ID`, see `isRowIdField`).
 */
export function lookupKeysFilter(lookup: LookupDef, keys: readonly unknown[]): Condition {
  return { field: lookupKeyField(lookup), op: "in", value: [...keys] };
}

/** The value of a row a `row_link` filters by: `row[value_from]`, or the row id for `id`. */
export function rowLinkValue(row: Row, link: RowLink): unknown {
  const from = link.filter.value_from;
  return from === ROW_ID && !Object.hasOwn(row, ROW_ID) ? row.__meta.id : row[from];
}

/** The condition a `row_link` opens its collection with. */
export function rowLinkCondition(row: Row, link: RowLink): Condition {
  return { field: link.filter.field, op: "eq", value: rowLinkValue(row, link) };
}

type SchemaOf = (collection: string) => Pick<SchemaDoc, "fields"> | undefined;

/**
 * Every lookup field of `schema` checked against its target, one message per
 * problem, `<collection>.<field>: …`: a lookup without a target block, a
 * target that is not served, and a `label_field`, `key_field`,
 * `extra_fields` entry or `color_field` the target's schema lacks. `schemaOf` answers the
 * schema of a served collection (`undefined` when it is not served).
 */
export function lookupProblems(
  collection: string,
  schema: Pick<SchemaDoc, "fields">,
  schemaOf: SchemaOf,
): string[] {
  const problems: string[] = [];
  for (const [field, def] of Object.entries(schema.fields)) {
    if (def.deleted || !isLookupType(def.type)) continue;
    problems.push(...lookupFieldProblems(collection, field, def, schemaOf));
  }
  return problems;
}

/** The problems of one lookup field (see `lookupProblems`); `[]` for any other field. */
export function lookupFieldProblems(
  collection: string,
  field: string,
  def: FieldDef,
  schemaOf: SchemaOf,
): string[] {
  if (!isLookupType(def.type)) return [];
  const at = `${collection}.${field}`;
  const lookup = def.lookup;
  if (!lookup) {
    return [`${at}: a ${def.type} field needs lookup: {collection, label_field}`];
  }
  const target = schemaOf(lookup.collection);
  if (!target) return [`${at}: lookup target ${lookup.collection} is not a served collection`];
  const names = [
    lookup.label_field,
    ...(lookup.key_field !== undefined && lookup.key_field !== ROW_ID ? [lookup.key_field] : []),
    ...(lookup.extra_fields ?? []),
    ...(lookup.color_field !== undefined ? [lookup.color_field] : []),
  ];
  return names
    .filter((name) => !live(target, name))
    .map((name) => `${at}: lookup target ${lookup.collection} has no field ${name}`);
}

/**
 * A view's `row_link` checked: the linked collection is served, its
 * `filter.field` is a live field there, and `value_from` is `id` or a live
 * field of this collection.
 */
export function rowLinkProblems(
  collection: string,
  link: RowLink,
  schema: Pick<SchemaDoc, "fields">,
  schemaOf: SchemaOf,
): string[] {
  const at = `${collection}.row_link`;
  const problems: string[] = [];
  const target = schemaOf(link.collection);
  if (!target) problems.push(`${at}: ${link.collection} is not a served collection`);
  else if (!live(target, link.filter.field)) {
    problems.push(`${at}: ${link.collection} has no field ${link.filter.field}`);
  }
  const from = link.filter.value_from;
  if (from !== ROW_ID && !live(schema, from)) {
    problems.push(`${at}: value_from ${from} is neither id nor a field of ${collection}`);
  }
  return problems;
}

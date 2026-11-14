import { z } from "zod";

export const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** The field-name rule: the server's SQL allowlist and the schema form both use it. */
export function isValidFieldName(name: unknown): name is string {
  return typeof name === "string" && FIELD_NAME_RE.test(name);
}

export const FieldNameSchema = z
  .string()
  .regex(FIELD_NAME_RE, "field names are lowercase snake_case, 1-63 chars, starting with a letter");

/** Every type udc-py knows, so dclabs documents parse. */
export const FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "year",
  "decimal",
  "bool",
  "date",
  "datetime",
  "image",
  "relation",
  "string_array",
  "rating",
  "json",
  "enum",
  "lookup",
  "lookup_array",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FieldTypeSchema = z.enum(FIELD_TYPES);

/** The types jsudc can store, sort and filter in phase 1. */
export const PHASE1_FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "decimal",
  "year",
  "bool",
  "date",
  "datetime",
  "json",
] as const satisfies readonly FieldType[];

export type Phase1FieldType = (typeof PHASE1_FIELD_TYPES)[number];

export function isPhase1Type(type: unknown): type is Phase1FieldType {
  return (PHASE1_FIELD_TYPES as readonly unknown[]).includes(type);
}

/**
 * The types whose value is the key of a row in another collection (level 1
 * of relations: the server stores, sorts and filters the key, the client
 * resolves the label). `lookup` holds one key, `lookup_array` a list of keys.
 */
export const LOOKUP_FIELD_TYPES = [
  "lookup",
  "lookup_array",
] as const satisfies readonly FieldType[];

export type LookupFieldType = (typeof LOOKUP_FIELD_TYPES)[number];

export function isLookupType(type: unknown): type is LookupFieldType {
  return (LOOKUP_FIELD_TYPES as readonly unknown[]).includes(type);
}

/** The types a server stores and `schema.add_field` accepts: phase 1 plus the lookups. */
export const STORABLE_FIELD_TYPES = [
  ...PHASE1_FIELD_TYPES,
  ...LOOKUP_FIELD_TYPES,
] as const satisfies readonly FieldType[];

export type StorableFieldType = (typeof STORABLE_FIELD_TYPES)[number];

export function isStorableType(type: unknown): type is StorableFieldType {
  return (STORABLE_FIELD_TYPES as readonly unknown[]).includes(type);
}

/**
 * Where a `lookup` / `lookup_array` field points. The field stores the value
 * of `key_field` of a row of `collection` (the row id, `__meta.id`, when
 * `key_field` is omitted); a client shows that row's `label_field`, and may
 * fetch `extra_fields` with it (a tooltip, a subtitle). The shape is checked
 * here; that the names exist in the target is checked by the server when it
 * loads its registry (`lookupProblems`), the only place both schemas meet.
 */
export const LookupDefSchema = z.looseObject({
  collection: z.string().min(1),
  key_field: FieldNameSchema.optional(),
  label_field: FieldNameSchema,
  extra_fields: z.array(FieldNameSchema).optional(),
});

export type LookupDef = z.infer<typeof LookupDefSchema>;

// Loose: udc-py field defs carry type-specific extras (rating_type, on_unknown, …).
export const FieldDefSchema = z
  .looseObject({
    type: FieldTypeSchema,
    length: z.number().int().positive().optional(),
    index: z.boolean().optional(),
    required: z.boolean().optional(),
    deleted: z.boolean().optional(),
    description: z.string().optional(),
    values: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    ref: z.string().optional(),
    label_field: z.string().optional(),
    lookup: LookupDefSchema.optional(),
  })
  .superRefine((def, ctx) => {
    if (def.type === "enum" && (!def.values || def.values.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["values"],
        message: "enum needs a non-empty values list",
      });
    }
    if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
      ctx.addIssue({ code: "custom", path: ["min"], message: "min is greater than max" });
    }
    if (def.lookup && !isLookupType(def.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["lookup"],
        message: `lookup is only for lookup and lookup_array fields, not ${def.type}`,
      });
    }
  })
  .transform(normaliseLookup);

/**
 * The udc-py spelling of a lookup is flat (`"ref": "boards", "label_field":
 * "name"`); it becomes the nested `lookup: {collection, label_field}`, so a
 * dclabs schema keeps parsing and everything after the parse (and `describe`)
 * sees one form. A flat lookup without `label_field` (a dc-lookups path such
 * as `"ref": "Books.Genre"`) is left as it is: it names no collection.
 */
function normaliseLookup<
  D extends { type: FieldType; ref?: string; label_field?: string; lookup?: LookupDef },
>(def: D): D {
  if (!isLookupType(def.type) || def.lookup || !def.ref || !def.label_field) return def;
  const { ref, label_field, ...rest } = def;
  return { ...rest, lookup: { collection: ref, label_field } } as D;
}

export type FieldDef = z.infer<typeof FieldDefSchema>;

/**
 * `version` is the wire string (`"v1"`, `"v2"`, …). `field_order` may be
 * omitted on input; it defaults to the key order of `fields`, and any field
 * it leaves out is appended in that order.
 */
export const SchemaDocSchema = z
  .object({
    version: z.string().min(1),
    core_fields: z.array(z.string()).default([]),
    fields: z.record(FieldNameSchema, FieldDefSchema),
    field_order: z.array(z.string()).optional(),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.field_order?.forEach((name, i) => {
      if (!(name in doc.fields)) {
        ctx.addIssue({
          code: "custom",
          path: ["field_order", i],
          message: `unknown field ${name}`,
        });
      }
      if (seen.has(name)) {
        ctx.addIssue({ code: "custom", path: ["field_order", i], message: `duplicate ${name}` });
      }
      seen.add(name);
    });
  })
  .transform((doc) => {
    const order = doc.field_order ?? [];
    const rest = Object.keys(doc.fields).filter((name) => !order.includes(name));
    return { ...doc, field_order: [...order, ...rest] };
  });

export type SchemaDocInput = z.input<typeof SchemaDocSchema>;
export type SchemaDoc = z.output<typeof SchemaDocSchema>;

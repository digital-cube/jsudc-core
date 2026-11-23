# @jsudc/core

[![npm](https://img.shields.io/npm/v/@jsudc/core)](https://www.npmjs.com/package/@jsudc/core)

The UDC (Universal Data Collection) protocol in TypeScript. One package holds
everything that crosses the wire between a UDC server and its clients, as Zod
schemas with inferred types: the message envelope, the filter DSL and an
in-memory evaluator, schema, view and source documents, every action's request
and response, row validation, and a small HTTP transport client.

A server validates what it receives with these schemas; a client builds its
requests with the same types. Neither side declares the protocol again, so the
two cannot drift. `zod` is the only runtime dependency; there is no React and no
Node API in the package, so it runs in the browser, in Node, in React Native and
in Angular alike.

```sh
npm install @jsudc/core
# or straight from a GitHub tag:
npm install github:digital-cube/jsudc-core#v0.5.0
```

Two entry points:

| Import               | What                                       |
| -------------------- | ------------------------------------------ |
| `@jsudc/core`        | the protocol: schemas, types, helpers      |
| `@jsudc/core/client` | `UdcClient`, the envelope RPC over `fetch` |

## The envelope

Every action is one `POST <base>/udc/<action>` with the request payload as the
body. The answer is an envelope whose `kind` says how it went:

```json
{ "kind": "udc.list.ok",  "id": "…", "payload": { "rows": [], "next_cursor": null, "total": 0 } }
{ "kind": "udc.list.err", "id": "…", "payload": { "code": "not_found", "message": "no collection books" } }
```

`requestKind`, `okKind`, `errKind` and `parseKind` build and split the kinds.
An error payload carries one of a closed set of codes (`not_found`,
`validation_error`, `version_conflict`, `forbidden`, `unsupported_op`,
`internal`); `UdcError` is the matching exception, with `toPayload()` and
`UdcError.fromPayload()` to cross the wire, and `isUdcError` /
`isVersionConflict` as guards.

"Not signed in" is not a code of its own: it is `forbidden` with
`details.reason: "unauthenticated"`, so a client that predates it still parses
the reply (as plain `forbidden`). `unauthenticatedError(message?, details?)`
builds it, and `isUnauthenticated(err)` recognises it on a `UdcError` or on a
raw error payload:

```json
{
  "kind": "udc.list.err",
  "id": "…",
  "payload": {
    "code": "forbidden",
    "message": "not signed in",
    "details": { "reason": "unauthenticated" }
  }
}
```

```ts
import { isUnauthenticated, unauthenticatedError } from "@jsudc/core";

// server side, in a host's `context` hook (see @jsudc/server, "Request context and scope")
if (!session) throw unauthenticatedError();

// client side
try {
  await client.list({ collection: "message" });
} catch (err) {
  if (isUnauthenticated(err)) location.assign("/login");
  else throw err;
}
```

## Actions

`ACTIONS` maps every action name to its request and response schema, so a
server can dispatch generically and a client is typed per action
(`ActionRequest<"list">`, `ActionResponse<"list">`).

| Action                     | Request                                                                              | Answer                                                            |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `collections`              | `{}`                                                                                 | `{ collections }`, what the server serves                         |
| `describe`                 | `{ collection }`                                                                     | schema, view config, capabilities, filterable fields, source info |
| `list`                     | `{ collection, filter?, sort?, page?, search? }`                                     | `{ rows, next_cursor, total }`                                    |
| `read`                     | `{ collection, id }`                                                                 | `{ row }`                                                         |
| `mutate`                   | `{ collection, op: "insert" \| "update" \| "delete", id?, row?, expected_version? }` | `{ row }`                                                         |
| `schema.add_field`         | `{ collection, name, fielddef, position }`                                           | `{ schema }`                                                      |
| `schema.update_field`      | `{ collection, name, fielddef }`                                                     | `{ schema }`                                                      |
| `schema.soft_delete_field` | `{ collection, field }`                                                              | `{ schema }`                                                      |
| `reindex`                  | `{ collection, scope, order_field?, gap? }`                                          | `{ updated }`                                                     |
| `tree.reparent`            | `{ collection, id, parent, order, fields, expected_version? }`                       | `{ row, updated }`                                                |
| `source.read`              | `{ collection }`                                                                     | the source file as written                                        |
| `mutate_many`              | `{ collection, op: "update" \| "delete", ids? \| filter?, except_ids?, row? }`       | `{ updated, failed }`                                             |

A row is flat: `{ __meta: { id, version }, ...fields }`. `update` and `delete`
take `expected_version`; a stale one fails with `version_conflict`. Paging is
either a `cursor` (keyset) or an `offset`, never both.

```ts
import { ListRequestSchema, MutateRequestSchema } from "@jsudc/core";

const list = ListRequestSchema.parse({
  collection: "books",
  sort: [{ field: "year", dir: "desc" }],
  page: { limit: 50 },
});

MutateRequestSchema.parse({
  collection: "books",
  op: "update",
  id: "42",
  row: { title: "Na Drini ćuprija" },
  expected_version: 3,
});
```

### Search answered by the source: `search`

By default the search box is the client's business: `@jsudc/react` turns its
text into `contains` conditions over `view.search.fields` and ANDs them into
`filter`. A collection whose source has its own full-text index (a `tsvector`
in Postgres, OpenSearch beside it) says `capabilities.search: "source"`
instead. The client then sends the text as `ListRequest.search` and composes
nothing: the source matches it, narrowed by `filter` and by the caller's row
scope (a search never widens what a caller may see), and with no `sort` it may
return the rows in relevance order. Absent means today's behaviour, and a
source without the capability refuses a `search` with `unsupported_op` rather
than ignore it. `sourceAnswersSearch(capabilities)` says which way to go;
`SEARCH_CAPABILITIES` lists the values (only `"source"` for now).

```ts
import { sourceAnswersSearch, UdcClient } from "@jsudc/core";

const client = new UdcClient({ httpUrl: "" });
const { capabilities } = await client.describe("mail");

const page = sourceAnswersSearch(capabilities)
  ? // The source matches and ranks; `filter` keeps the chips only.
    await client.list({ collection: "mail", search: "invoice -draft", page: { limit: 50 } })
  : // Today's way: the text becomes `contains` in the filter.
    await client.list({
      collection: "mail",
      filter: { field: "subject", op: "contains", value: "invoice" },
      page: { limit: 50 },
    });
```

### The change feed: `changes`

A server that pushes changes says `capabilities.changes: true` on a
collection; absent means "poll as today" (`view.refresh_interval_ms`). It is a
new capability, not `subscribe`, which stays `false`: that one promises
udc-py's WebSocket subscription actions, which jsudc does not implement.

The feed is one long-lived `GET ${httpUrl}/udc/changes?collections=a,b`
(`CHANGES_ROUTE`) answered as Server-Sent Events. Each `change` event's data
is a `ChangeEvent`:

```ts
type ChangeEvent = {
  collection: string;
  op: "insert" | "update" | "delete"; // CHANGE_OPS, the same three as mutate
  ids?: string[]; // the changed rows you may see; absent: "this collection changed"
};
```

It carries no row data: the client refetches under its own scope, so a field
the caller may not see can never travel through the feed, and the server
only tells a caller about rows inside the caller's own scope. Without `ids`
(a burst coalesced into one event, a renumbering, a host that did not say
which rows) refetch whatever is shown of that collection. There is no replay:
after a reconnect, refetch, because changes made while the stream was down
were not sent.

`UdcClient.changes(opts)` reads the stream with `fetch` (not `EventSource`,
which cannot send headers), so the client's `headers` function (evaluated per
connection) and `credentials` apply exactly as to every call. It calls
`onChange` per event, `onOpen({ reconnected })` each time the stream is
subscribed, and `onError(err, { attempt, delayMs })` before each reconnect;
a dropped or idle stream (no heartbeat for `idleTimeoutMs`, default 45 s) is
reopened with exponential backoff and jitter (`minDelayMs`, default 1 s or the
server's `retry:` hint, up to `maxDelayMs`, default 30 s). It resolves when
`signal` aborts, and rejects without retrying when the server refuses: HTTP
401 with the "not signed in" error (`isUnauthenticated`), 403 `forbidden`, 404
`not_found` (a collection the caller may not see), 400 `validation_error`.

```ts
import { isUnauthenticated, sourcePushesChanges } from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";

const udc = new UdcClient({ httpUrl: "", headers: () => ({ "x-csrftoken": csrf() }) });
const { capabilities } = await udc.describe("messages");

if (sourcePushesChanges(capabilities)) {
  const stop = new AbortController();
  udc
    .changes({
      collections: ["messages", "folders"],
      onChange: (e) => refetch(e.collection, e.ids), // ids absent: refetch it all
      onOpen: ({ reconnected }) => reconnected && refetchEverything(),
      signal: stop.signal, // stop.abort() closes the stream
    })
    .catch((err) => {
      if (isUnauthenticated(err)) location.assign("/login");
    });
}
```

`ChangeEventSchema`, `ChangeOpSchema`, `CHANGE_EVENT` / `CHANGES_READY_EVENT`
(the SSE event names; `ready` carries `{ collections }` once the stream is
subscribed) and `SseParser` (an incremental event-stream parser, for a host
that reads the stream itself) are exported as well.

### Many rows at once: `mutate_many`

`mutate_many` changes (`update`, with the patch `row`) or deletes many rows in
one request, inside the caller's row scope. It names the rows either by `ids`
(at most `MUTATE_MANY_MAX_IDS`, 10 000) or by `filter` — everything that
matches, minus `except_ids` ("all in the filter, except these"); exactly one of
`ids` and `filter`, and `{ and: [] }` is the filter that matches every row.
There is no `expected_version`: the server bumps the version of every row it
changes. The answer says how many rows were changed and which of the given ids
were not (`not_found` for a missing id and for one outside the scope alike). A
collection that serves it says `capabilities.mutate_many: true`; absent means
`false`, and a client loops over `mutate` instead.

```ts
import { filter, UdcClient } from "@jsudc/core";

const client = new UdcClient({ httpUrl: "" });

// The selected rows.
await client.mutateMany({ collection: "mail", op: "delete", ids: ["m1", "m2"] });

// Everything in the inbox but two, archived in one request.
const { updated, failed } = await client.mutateMany({
  collection: "mail",
  op: "update",
  filter: filter.eq("folder", "inbox"),
  except_ids: ["m7", "m9"],
  row: { archived: true },
});
```

### Host actions, typed end to end

A host adds actions of its own with `defineHostAction`: the name and the Zod
schemas of the request and the response, written once in a module the server
and the browser both import. `@jsudc/server`'s `Dispatcher.register` takes the
definition (the handler's payload and return type follow from it, and it
receives the request context), and `UdcClient.call` takes it too: the payload
is typed from the request schema, and the answer is parsed with the response
schema (one that does not parse throws `UdcError` `internal`). A built-in
action name is refused. `HostActionPayload`, `HostActionRequest`,
`HostActionReply` and `HostActionResponse` name the four sides.

```ts
// shared/actions.ts — imported by the server and the browser
import { defineHostAction } from "@jsudc/core";
import { z } from "zod";

export const archiveThread = defineHostAction({
  name: "mail.archive_thread",
  request: z.object({ thread_id: z.string() }),
  response: z.object({ archived: z.number().int() }),
});

// browser
const { archived } = await client.call(archiveThread, { thread_id: "t42" });
```

`call` keeps its signature for the built-in actions. For an action without a
shared definition, a plain name with explicit types is the escape hatch:
`client.call<{ pong: boolean }, { at: number }>("ping", { at: 1 })` (the answer
is not checked; a built-in name never falls through to it).

### Action eligibility and what an action does

An `ActionDef` (a view's `row_action_defs` and `bulk_actions`) says when it
applies with `when`: a boolean, or a filter node. `isActionEligible(def, row)`
evaluates it for one row and `isActionEligibleForAll(def, rows)` for a
selection (it must hold for every row; an empty selection is `false`). A filter
is evaluated with `evaluateFilter` against `row.__meta.state` when the source
provides one (udc-py's convention), else against the row's own fields; a
filter it cannot evaluate makes the action ineligible.

Three optional keys say what an action does when the client has no handler
for it: `set`, the patch it applies (`{ archived: true }`); `action`, the
server action to call (default the `kind`, `actionServerName(def)`); and
`confirm`, ask first (`true` or the question; default on for `delete` only,
`actionConfirms(def)`).

```ts
import { ActionDefSchema, actionConfirms, filter, isActionEligibleForAll } from "@jsudc/core";

const archive = ActionDefSchema.parse({
  kind: "archive",
  label: "Archive",
  when: filter.eq("archived", false),
  set: { archived: true },
});

isActionEligibleForAll(archive, selectedRows); // false as soon as one row is archived
actionConfirms(archive); // false; a "delete" action would ask
```

## Filter DSL

A filter is a condition `{ field, op, value?, case_insensitive? }` or a group
`{ and: [...] }`, `{ or: [...] }`, `{ not: ... }`. The `filter` builders write
them for you, and `evaluateFilter(node, row)` runs one in memory with the same
semantics as the server's SQL compiler (useful for tests and optimistic
updates). One example per operator family:

```ts
import { evaluateFilter, filter } from "@jsudc/core";

filter.eq("status", "open"); // eq, neq
filter.in("country", ["RS", "HR"]); // in, not_in
filter.contains("title", "drina"); // contains, starts_with, ends_with (case-insensitive by default for contains)
filter.gte("year", 1945); // gt, gte, lt, lte
filter.between("price", 10, 20); // between, both ends inclusive
filter.isNull("deleted_at"); // is_null, is_not_null
filter.and(filter.eq("status", "open"), filter.not(filter.lt("year", 1900))); // and, or, not

evaluateFilter(filter.gte("year", 1945), { year: 1961 }); // true
```

The same JSON goes over the wire, so `{ "field": "year", "op": "gte", "value": 1945 }`
is exactly what `filter.gte("year", 1945)` returns; `FilterNodeSchema` validates
it.

## Schema, view and source documents

`SchemaDocSchema` (`{ version, core_fields, fields, field_order }` with one
`FieldDef` per field), `ViewConfigSchema` (renderers, columns, filters, search,
and the options of every renderer: cards, kanban, calendar, tree, map, chart)
and `SourceConfigSchema` parse the `schema.json`, `view.yaml` and `source.yaml`
files a collection is described by. `isValidFieldName` / `FIELD_NAME_RE` hold
the field-name rule (`^[a-z][a-z0-9_]{0,62}$`).

A view's table columns are `columns` plus a default column for every live
schema field it does not list. To keep a field out of the table while the rows,
the filter builder and every cell's `row` still carry it, mark its column
`hidden: true`, or set `columns_mode: listed` for `columns` only (0.5.2):

```yaml
# collections/mail_messages/view.yaml
columns_mode: listed # all (default) | listed
columns:
  - { field: subject, render: mail_subject, width: 520 } # the cell reads row.snippet
  - { field: date, width: 110 }
  - { field: folder_id, hidden: true } # with columns_mode: all, the per-field way
```

`source.yaml` names one of six kinds (`SOURCE_KINDS`), each with its options
schema: `postgres_jsonb` (one table, every field in `data jsonb`), `memory`,
`filesystem`, `http_api`, `yaml_menu`, and `postgres_table` (an ordinary
relational table with typed columns). `sourceGroup(kind)` puts each in the
sidebar's `database`, `files` or `internet` group; `postgres_table` is
`database`. Without a file a collection is `postgres_jsonb`.

`PostgresTableOptionsSchema`, the `postgres_table` block. Only identifiers
(lowercase snake_case, the table-name rule) go in the file; SQL expressions, a
`FROM` with joins and a base `WHERE` are given to `@jsudc/server`'s
`PostgresTableSource` in code:

```yaml
# collections/messages/source.yaml
kind: postgres_table
options:
  table: message # default: the collection name
  id_column: id # default: id
  id_type: uuid # uuid (default) | text | integer
  version_column: version # optional; without it every row is version 1
  columns: # field -> column; a field without an entry reads its own name
    subject: subject_line
  total_count: false # default true; false: no count(*), total is null
```

## Lookups and drill-down

A field of type `lookup` stores the **key** of a row of another collection,
`lookup_array` a list of keys. The field says where the key points:

```json
"board_id":  { "type": "lookup", "required": true, "index": true,
               "lookup": { "collection": "boards", "label_field": "name" } },
"assignees": { "type": "lookup_array",
               "lookup": { "collection": "org", "label_field": "name", "extra_fields": ["title"] } }
```

`LookupDefSchema` is `{ collection, key_field?, label_field, extra_fields? }`.
Without `key_field` the key is the target's row id (`__meta.id`). A key is a
string or an integer; `validateRow` refuses anything else. The flat udc-py
spelling (`"ref": "boards", "label_field": "name"`) parses too and comes out
nested, so a dclabs schema needs no edit; a `ref` without `label_field` (a
dc-lookups path such as `Books.Genre`) is left as it is.

Nothing in the protocol changes: the key travels as it is, a filter compares
the key (`LOOKUP_FILTER_OPS`: `eq neq in not_in is_null is_not_null`; on
`lookup_array` `in` / `not_in` mean "any key in the list" / "none"), and a
client resolves the labels with one `list` over the target
(`lookupKeysFilter(lookup, keys)`). A condition on `id`, in a collection whose
schema has no live `id` field, means the row id (`isRowIdField`), so a lookup by
id needs no stored copy of it.

Core checks the shape. Whether `collection`, `label_field`, `key_field` and
`extra_fields` exist needs the other collection's schema, so the server checks
that when it loads its registry: `lookupProblems(collection, schema, schemaOf)`
returns one message per problem, `<collection>.<field>: lookup target <x> has no
field <y>`.

**Drill-down.** `view.yaml` may say where a click on a row goes:

```yaml
row_link:
  collection: tickets
  filter: { field: board_id, value_from: id }
```

That opens `tickets` filtered by `board_id eq <the row's id>`
(`rowLinkCondition(row, link)`). `value_from` is a field of this collection, or
`id` for the row id. `rowLinkProblems` checks both ends. No lookup field is
needed: any two collections that share a value can be linked.

`relation` stays reserved for level 2 (a server-side JOIN, `expand`, dotted
paths in filter and sort); a schema that has one keeps parsing.

## validateRow

`validateRow(schema, row, { mode })` checks a row (`mode: "insert"`) or a
partial patch (`mode: "patch"`) against a schema and returns every problem; an
empty list means valid. The server runs it before writing, a form runs it
before sending.

```ts
import { SchemaDocSchema, validateRow } from "@jsudc/core";

const schema = SchemaDocSchema.parse({
  version: "1",
  fields: { title: { type: "string", required: true }, year: { type: "integer" } },
  field_order: ["title", "year"],
});

validateRow(schema, { year: "soon" }, { mode: "insert" });
// [{ field: "year", message: "must be an integer" }, { field: "title", message: "is required" }]
```

## The client

```ts
import { UdcClient } from "@jsudc/core/client";

const udc = new UdcClient({ httpUrl: "https://api.example.com" });
const { rows, total } = await udc.list({ collection: "books", page: { limit: 20 } });
```

`UdcClient({ httpUrl, headers?, credentials?, fetch? })` has one method per action
(`collections`, `describe`, `list`, `read`, `mutate`, `reindex`,
`treeReparent`, `schemaAddField`, `schemaUpdateField`,
`schemaSoftDeleteField`, `sourceRead`) and a generic `call(action, payload)`.
It returns the `.ok` payload and throws `UdcError` on `.err`; a transport
failure (network, a non-200 from a proxy) is a plain `Error`, so a retry policy
can tell the two apart; a 401 / 403 is a refusal and a `UdcError` (below). Every request carries an `x-udc-message-id` header for
log correlation. It needs only a global `fetch` (browsers, Node 18+, React
Native); pass `fetch` to inject one.

### Sessions: headers per call, credentials, 401 / 403

`headers` is either a fixed object or a function the client calls before every
request (it may be async), so a CSRF token that changes with the session needs
no new client. `credentials` is passed to `fetch` as is when given: leave it out
on the same origin, use `"include"` to send a cookie session to another origin.

```ts
import { UdcClient } from "@jsudc/core/client";

const csrf = () => document.cookie.match(/(?:^|; )csrftoken=([^;]*)/)?.[1] ?? "";

const udc = new UdcClient({
  httpUrl: "https://api.example.com",
  credentials: "include", // the session cookie travels to the other origin
  headers: () => ({ "x-csrftoken": csrf() }), // read on every call
});
```

An HTTP 401 or 403 from whatever stands in front of `/udc` (the host's auth
middleware, a gateway) is a refusal, not a transport failure, so it is a
`UdcError` and nothing retries it:

| HTTP status   | thrown                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 401           | `forbidden`, `details: { reason: "unauthenticated", http_status: 401 }` — the same error as the in-protocol "not signed in", so `isUnauthenticated(err)` is `true` |
| 403           | `forbidden`, `details: { http_status: 403 }`                                                                                                                       |
| other non-200 | a plain `Error` (`udc.<action>: HTTP <status>`), as before                                                                                                         |

```ts
import { isUnauthenticated } from "@jsudc/core";

try {
  await udc.list({ collection: "message" });
} catch (err) {
  if (isUnauthenticated(err)) location.assign("/login");
  else throw err;
}
```

## Develop

Requires Node 24 (`.nvmrc`).

```sh
npm ci              # also builds dist (the prepare script)
npm run typecheck   # tsc --noEmit over src and test
npm run lint        # Biome
npm test            # Vitest
npm run build       # tsc -> dist (ESM + .d.ts)
```

## License

MIT, see [LICENSE](LICENSE).

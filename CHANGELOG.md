# Changelog

All notable changes to `@jsudc/core` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `@jsudc/core`,
`@jsudc/server` and `@jsudc/react` share one version line and release together.

## [Unreleased]

## [0.7.0] - 2026-11-23

The first SQLite set: a SQLite table as a collection kind and the error code a
client sees when another writer holds the file; released together with
`@jsudc/server` 0.7.0 (which also makes `pg` optional) and `@jsudc/react`
0.7.0. Every addition is optional: a 0.6.0 payload or `source.yaml` parses
exactly as before.

### Added

- `sqlite_table` in `SOURCE_KINDS` (group `database`): one table of a SQLite
  file with typed columns. `SqliteTableOptionsSchema` is
  `PostgresTableOptionsSchema` plus `database`, the name of the handle the host
  registered (default `DEFAULT_SQLITE_DATABASE`, `main`). Its options:
  `database`, `table` (default the collection name), `id_column` (default
  `id`), `id_type` (`uuid`, the default, `text` or `integer`; a `uuid` id is
  stored as lower-case TEXT), `version_column` (optional; without it every row
  is version 1), `columns` (field → column) and `total_count` (default
  `true`). The file's path is never in `source.yaml`: the host opens the file
  and registers the handle. `@jsudc/server` serves it with
  `SqliteTableSource` from `@jsudc/server/sqlite`.
- The error code `busy` (and the guard `isBusy`): the data was locked by another
  writer for longer than the server waits (`@jsudc/server`: 5 s by default),
  e.g. another process holding a SQLite file's write lock past its busy
  timeout. Nothing was written; the request may be retried. A client sees it as the error payload of any write (`create`,
  `update`, `delete`, `mutate_many`, `reindex`, a host action that writes) and,
  rarely, of a read that had to wait for a lock; `UdcClient` throws it as a
  `UdcError` whose `code` is `busy`. A client older than this code reads such a
  reply as a malformed error payload (`internal`).

## [0.6.0] - 2026-11-23

What a mail client's list views asked for after 0.5.0: a view's own default
order, columns kept out of the table, the fields a source sorts on, column
widths that follow the pane; released together with `@jsudc/server` 0.6.0 and
`@jsudc/react` 0.6.0. Every addition is optional: a 0.5.0 payload or view
parses exactly as before.

### Added

- `sortable` in `DescribeResponseSchema` (`SortableSchema`, `{ fields }`): the
  fields the source sorts on; any other in `ListRequest.sort` is refused with
  `validation_error`. Optional: absent (an older server), every field sorts.
  `sortableField(describe, field)` reads it. `@jsudc/server` fills it,
  `@jsudc/react` draws a plain header for a field not in it.
- `sortable: false` on a column config (`ColumnConfigSchema`): the header is not
  a sort button even when the source sorts on the field. Display only.
- `hidden: true` on a column config (`ColumnConfigSchema`): the field is not a
  table column, and `describe` adds no default column for it; it stays in the
  schema, the rows, the filter builder and search.
- `columns_mode` on a view (`ColumnsModeSchema`, `COLUMNS_MODES`): `all` (the
  behaviour so far, and the default) or `listed`, a table of the view's
  `columns` only.
- A column `width` of `fill` (`COLUMN_WIDTH_FILL`, `isFillColumn`): the column
  takes the rest of the table's width; `grow` (its share against other `fill`
  columns) and `min_width` (its floor) size it, and are refused on a column
  that does not fill. `hide_below` on any column: left out while the table is
  narrower than that many pixels. A numeric `width` parses exactly as before;
  `@jsudc/react` lays them out (see its changelog).
- `default_sort` in `ViewConfigSchema`: the order a view's rows come in until
  the user picks one, a list of `SortKey`s. Optional; a view without it parses
  exactly as before. `@jsudc/react` applies it (see its changelog).
- `defaultSortProblems(sort, schema)`: the keys of a `default_sort` whose field
  the schema lacks or has deleted, or that name a field twice. `@jsudc/server`
  refuses such a view when it loads the registry.

## [0.5.0] - 2026-11-22

What the next features of a multi-tenant host stand on: many rows changed in one
request, the host's own actions typed end to end, search answered by the source
and the change feed on the wire; released together with `@jsudc/server` 0.5.0
and `@jsudc/react` 0.5.0. Every addition is optional: a 0.4.0 payload parses
exactly as before.

### Added

- Action `mutate_many`: change (`update`, with the patch `row`) or delete many
  rows in one request, by `ids` (at most `MUTATE_MANY_MAX_IDS`, 10 000) or by
  `filter` minus `except_ids`, inside the caller's row scope; no
  `expected_version`. It answers `{ updated, failed: [{ id, code, message? }] }`.
  `MutateManyRequestSchema`, `MutateManyResponseSchema`,
  `MutateManyFailureSchema`, `MUTATE_MANY_OPS`; in `ACTIONS` (so in
  `ACTION_NAMES`), and `UdcClient.mutateMany(req)`.
- Capability `mutate_many` (optional; absent means `false`).
- Host actions typed end to end: `defineHostAction({ name, request, response })`
  returns a `HostAction` that `UdcClient.call(action, payload)` accepts (payload
  typed from the request schema, the answer parsed with the response schema)
  and `@jsudc/server`'s `Dispatcher.register` accepts. `isHostAction`,
  `HOST_ACTION_NAME_RE`, and the types `HostActionPayload`, `HostActionRequest`,
  `HostActionReply`, `HostActionResponse`. `UdcClient.call` also takes any
  other name with explicit types (`call<Res, Req>(name, payload)`); the
  built-in actions stay typed as before.
- Action eligibility: `isActionEligible(def, row)` and
  `isActionEligibleForAll(def, rows)` evaluate an `ActionDef`'s `when` (a
  boolean, or a filter over `row.__meta.state` when the row has one, else over
  its fields); `eligibilitySubject(row)` says which.
- `ActionDef` gains three optional, typed keys: `set` (the patch the action
  applies), `action` (the server action to call; `actionServerName(def)`
  defaults it to the `kind`) and `confirm` (`true` or the question to ask;
  `actionConfirms(def)` defaults it to on for `delete`).
- Search answered by the source: `ListRequest.search` (optional), the text of
  the search box for a source that matches it itself, and the capability
  `search` (optional; its only value is `"source"`, absent means the client
  composes `contains` as before). `SEARCH_CAPABILITIES`,
  `SearchCapabilitySchema`, the type `SearchCapability`, and
  `sourceAnswersSearch(capabilities)`.
- The change feed (wire side): the capability `changes` (optional; absent
  means poll, `subscribe` stays `false`), the event `ChangeEventSchema` /
  `ChangeEvent` (`{ collection, op, ids? }`, no row data), `CHANGE_OPS` /
  `ChangeOpSchema` (`insert`, `update`, `delete`), `CHANGES_ROUTE`
  (`/udc/changes`), the SSE event names `CHANGE_EVENT` and
  `CHANGES_READY_EVENT` with `ChangesReadySchema`, `sourcePushesChanges(capabilities)`
  and `SseParser`, an incremental Server-Sent Events parser.
  `UdcClient.changes({ collections, onChange, onOpen?, onError?, signal?,
  minDelayMs?, maxDelayMs?, idleTimeoutMs? })` reads the stream with `fetch`
  (so `headers` and `credentials` apply), reconnects with backoff, reports
  `reconnected` so the caller can refetch, and stops on abort or a refusal
  (401 unauthenticated, 403, 404, 400). The type `ChangesOptions` from
  `@jsudc/core/client`.

## [0.4.0] - 2026-11-22

What a multi-tenant host needs on the wire: "not signed in" inside the protocol,
a client for cookie sessions and CSRF, and the `postgres_table` source kind;
released together with `@jsudc/server` 0.4.0 and `@jsudc/react` 0.4.0.

### Added

- "Not signed in" as `forbidden` with `details.reason: "unauthenticated"` (no
  new error code, so a 0.3.x client still parses it): `unauthenticatedError()`
  builds it, `isUnauthenticated(err)` recognises it on a `UdcError` or an error
  payload, `UNAUTHENTICATED_REASON` is the reason string. The server's request
  context (`@jsudc/server` `context`) throws it to refuse an anonymous request.
- `UdcClient` for cookie sessions and CSRF: `headers` may be a function
  (`UdcHeaders`, `() => Record<string, string> | Promise<…>`) the client calls
  before every request; a plain object still works. New option `credentials`
  (`RequestCredentials`), passed to `fetch` when given.
- Source kind `postgres_table` (group `database`): `SOURCE_KINDS`, `sourceGroup`
  and `SourceConfigSchema` know it, with its options schema
  `PostgresTableOptionsSchema` / `PostgresTableOptions` (`table`, `id_column`,
  `id_type` of `TABLE_ID_TYPES` = `uuid | text | integer`, `version_column`,
  `columns` field → column name, `total_count`). Table and column names are
  validated as identifiers. `@jsudc/server`'s `PostgresTableSource` serves it.

### Changed

- `UdcClient`: an HTTP 401 in front of `/udc` now throws the same `UdcError` as
  the in-protocol "not signed in" (`forbidden`, `details.reason:
  "unauthenticated"`, plus `details.http_status: 401`), and an HTTP 403 throws
  `forbidden` with `details.http_status: 403`. Until now both were a plain
  `Error`, which `@jsudc/react` retried twice and then showed as a transport
  failure with Retry. This is the one deliberate change an unchanged host can
  see: a 401 / 403 never produced a working view, so the only difference is
  that the failure shows at once, as `forbidden`, instead of after two
  retries. Every other non-200 is still a plain `Error`.

## [0.3.0] - 2026-11-15

Lookups, level 1, and drill-down from a row (`row_link`), released together
with `@jsudc/server` 0.3.0 and `@jsudc/react` 0.3.0.

### Added

- Lookups, level 1: `LookupDefSchema` (`{ collection, key_field?, label_field,
  extra_fields? }`) as `FieldDef.lookup` of a `lookup` / `lookup_array` field;
  `LOOKUP_FIELD_TYPES`, `isLookupType`, `STORABLE_FIELD_TYPES`, `isStorableType`.
- The flat udc-py form (`ref` + `label_field`) of a lookup is normalised to
  `lookup: {collection, label_field}`.
- `lookupProblems` / `lookupFieldProblems` and `rowLinkProblems`, the
  cross-collection checks a server runs when it loads its registry.
- `ViewConfig.row_link` (`RowLinkSchema`): drill-down from a row to another
  collection filtered by one of its values (`value_from`, or `id`).
- `lookupOf`, `lookupKeyField`, `lookupKeyOf`, `lookupKeysFilter`,
  `rowLinkValue`, `rowLinkCondition`, `isRowIdField`, `ROW_ID`, `isLookupKey`.
- `LOOKUP_FILTER_OPS`, `LOOKUP_ARRAY_FILTER_OPS`.

### Changed

- A `lookup` value is a key: a string or an integer (was: a string). A
  `lookup_array` value is a list of keys (was: a list of strings).
- `filterableForType("lookup_array")` is `in not_in is_null is_not_null`,
  default `in` (was `contains is_null is_not_null`).

## [0.2.0] - 2026-10-30

No changes; released in lockstep with `@jsudc/react` 0.2.0, whose breaking
changes move the shared version line to 0.2. The code and the API are those of
0.1.1.

## [0.1.1] - 2026-10-29

First release on npmjs.org. No change to the code or the API.

### Added

- Published to npmjs.org as a public package; `npm install @jsudc/core`.
- Tags `v*` publish themselves from GitHub Actions with npm provenance
  (`.github/workflows/publish.yml`, OIDC trusted publishing, no token).
- `CHANGELOG.md`.

### Changed

- `package.json`: `publishConfig.access: "public"`, `repository` / `bugs` in
  object form, keywords `universal-data-collections` and `data-grid`.
- README: install from npm; the GitHub tag stays as an alternative.

## [0.1.0] - 2026-10-29

First tagged version, installed from the GitHub tag.

### Added

- The UDC protocol in TypeScript: the request / response envelope, the action
  payloads, the filter DSL with its evaluator, the schema, view and source
  documents (table, cards, kanban, calendar, tree, map and chart view options;
  postgres_jsonb, memory, filesystem, http_api and yaml_menu sources), and
  `validateRow`.
- `@jsudc/core/client`: `UdcClient`, the envelope RPC over `fetch`, and
  `UdcError`.

[Unreleased]: https://github.com/digital-cube/jsudc-core/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/digital-cube/jsudc-core/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/digital-cube/jsudc-core/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/digital-cube/jsudc-core/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/digital-cube/jsudc-core/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/digital-cube/jsudc-core/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/digital-cube/jsudc-core/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/digital-cube/jsudc-core/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/digital-cube/jsudc-core/releases/tag/v0.1.0

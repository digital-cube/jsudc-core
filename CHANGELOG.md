# Changelog

All notable changes to `@jsudc/core` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `@jsudc/core`,
`@jsudc/server` and `@jsudc/react` share one version line and release together.

## [Unreleased]

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

[Unreleased]: https://github.com/digital-cube/jsudc-core/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/digital-cube/jsudc-core/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/digital-cube/jsudc-core/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/digital-cube/jsudc-core/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/digital-cube/jsudc-core/releases/tag/v0.1.0

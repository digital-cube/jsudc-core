# Changelog

All notable changes to `@jsudc/core` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `@jsudc/core`,
`@jsudc/server` and `@jsudc/react` share one version line and release together.

## [Unreleased]

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

[Unreleased]: https://github.com/digital-cube/jsudc-core/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/digital-cube/jsudc-core/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/digital-cube/jsudc-core/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/digital-cube/jsudc-core/releases/tag/v0.1.0

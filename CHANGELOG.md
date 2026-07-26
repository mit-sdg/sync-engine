# Changelog

Notable changes to `@mit-sdg/sync-engine` are recorded here. Compare links are
the complete source of truth for each release.

## Unreleased

### Changed

- Reorganized the package into explicit `language`, `assembly`, `boundary`,
  `client`, `tooling`, `advanced`, and `utils` subpaths. Consumers of the old
  former aggregate entrypoints must migrate imports to the subpath
  that owns each symbol; `docs/public-surface.md` is the complete register.
- Reworked reaction authoring around callable action lines, explicit
  return/refusal postures, sibling paths, views, and formers.
- Made assembled concept actions consistently asynchronous and added generated
  wire, HTTP-floor, persistence, inspection, and read-back tooling.
- Added durable, non-consuming reaction-evaluation failure records and prompt
  timeout/abort settlement while already-forwarded work continues.

## [0.3.0] - 2026-07-10

- Added the concept/reaction engine, persistence, HTTP and client surfaces,
  tooling, examples, and package checks described in the
  [0.3.0 release notes](https://github.com/mit-sdg/sync-engine/releases/tag/v0.3.0).

## [0.2.0]

- See the [0.1.1...0.2.0 comparison](https://github.com/mit-sdg/sync-engine/compare/v0.1.1...v0.2.0).

## [0.1.1]

- See the [0.1.0...0.1.1 comparison](https://github.com/mit-sdg/sync-engine/compare/v0.1.0...v0.1.1).

## [0.1.0]

- Initial public release. See the
  [0.1.0 release notes](https://github.com/mit-sdg/sync-engine/releases/tag/v0.1.0).

[0.3.0]: https://github.com/mit-sdg/sync-engine/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v0.2.0
[0.1.1]: https://github.com/mit-sdg/sync-engine/releases/tag/v0.1.1
[0.1.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v0.1.0

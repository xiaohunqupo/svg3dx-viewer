# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-23

### Added

- `CreateViewerOptions.extraDefs` for on-demand named-def preview
- `CreateViewerOptions.retainInactive` to keep skipped conditional branches in evaluation results
- Bool CSG build passes operand index; scene types include transform matrices
- `EmbedViewer.setExtraDefs` force-refresh option
- glTF reference support; delayed CSG fallback for glTF meshes
- Path / sweep parsing updates aligned with the draft spec
- Section helpers export and improved transparent / helper render order

### Changed

- Depends on `svg3dx-ffi-wasm@^0.1.2`
- Removed legacy mesh / triangle node paths in favor of current draft geometry

## [0.1.0] - 2026-11-16

### Added

- Initial embeddable `createViewer` / `EmbedViewer` library release

[0.1.1]: https://github.com/xiaohunqupo/svg3dx-viewer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/xiaohunqupo/svg3dx-viewer/releases/tag/v0.1.0

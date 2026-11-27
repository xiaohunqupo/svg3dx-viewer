# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`0.2.x` tracks svg3dx draft 0.2. The last number is the patch.

## [0.2.0] - 2026-11-27

Requires `svg3dx-ffi-wasm@0.2.0`.

### Added

- Draft 0.2 positioning points and `ref(#id)`
- SMIL-shaped animation playback in the embed viewer and params bar (play/pause, pinned params, clock updates without rebuilding the scene)

### Changed

- Positioning points are not drawn while browsing
- The 2D overlay skips both `urn:s3dx:draft:0.1` and `urn:s3dx:draft:0.2`, so 3D elements are not meshed as SVG

[0.2.0]: https://github.com/xiaohunqupo/svg3dx-viewer/compare/v0.1.2...v0.2.0

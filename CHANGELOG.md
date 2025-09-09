# Change Log

All notable changes to the "sxml" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

### Added

- Initial release.

## [0.2.0]

### Fixed

- Improved validation speed by caching schema after initial load.

## [0.2.1]

### Fixed

- Filtering of attribute names in suggestions.

### Added

- Wrap text with tags using Ctrl+e.

### Changed

- Switched to npm version of [salve-annos](https://github.com/raffazizzi/salve).

## [0.2.2]

### Fixed

- Support for schema association with multiline `<?xml-model?>`.

## [0.3.0]

### Changed

- Updated to salve-annos 1.1.0 which has improved validation of xs:anyURI.

## [1.0.0]

### Added

- Support for Schematron via worker.
- Support for XInclude/@href

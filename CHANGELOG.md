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

## [0.4.0]

### Added

- Support for Schematron via worker.
- Support for XInclude/@href

### Changed

- Element content errors are now reported on the opening tag instead of the closing tag.

### Fixed

- Better positioning of error ranges. 


## [0.5.0]

### Added

- Suggestions now provide IDREF and xsd:anyURI recommendations for IDs in the same document
- XML Formatter
- Unit tests

### Fixed

- Associated local RNG schemas now reload on change.
- Better feedback when RelaxNG file isn't correctly associated

## [0.5.1]

### Fixed

- Schema association now reads each `<?xml-model?>` separately, so documents with several PIs pick the right RELAX NG and Schematron files regardless of the order of the pseudo-attributes or the quotes used.
- Schematron errors reported on the document node are now anchored to the root element instead of being dropped.
- Schematron results that can't be matched back to the document no longer interrupt validation.
- A validation run that gets aborted by a newer one no longer cancels the newer run.

### Changed

- Lowered the minimum supported VS Code version to 1.86 to cover more installations.
- Updated dependencies.
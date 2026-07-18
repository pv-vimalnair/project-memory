# Catalog versioning

Project Memory catalog releases follow SemVer and preserve historical releases.

- Patch: documentation or non-contract metadata corrections that do not change selection or authority behavior.
- Minor: additive definitions that preserve every existing ID and selection boundary.
- Major: removal, replacement, or any change to schemas, signals, compatibility, duties, authority, or selection behavior.

Definitions move through `active`, `deprecated`, and `retired` lifecycle states. A deprecated or retired definition must name its replacement and provide migration notes; consumers never receive a silent upgrade. Migrations are explicit, versioned, reviewable, and preserve the previous source and lock.

Published release directories, bundles, lock files, and checksums are immutable. A correction creates a new SemVer release. `catalog.lock.json` is the canonical source-to-artifact provenance record and `SHA256SUMS` verifies the generated bundle and lock bytes.

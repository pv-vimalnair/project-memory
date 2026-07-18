# Catalog extensions

Every extension owns a unique namespace, declares the exact compatible catalog SemVer range, and provides the same schema, reference, fixture, and authority evidence as a built-in definition. Recommended IDs begin with an organization-controlled namespace such as `x-acme.*`.

An extension may add blueprints, components, domains, overlays, adapters, patterns, or companion rules, but it may not shadow a built-in ID, replace canonical truth, broaden worker authority, weaken a gate, or bypass a mandatory companion. Core and taxonomy halves must share an exact ID and version.

Local additions remain visibly local until accepted into a new immutable catalog release. Acceptance requires deterministic validation, explicit migration notes when an earlier extension ID is deprecated, and an updated release lock. Removing or changing an accepted boundary follows the catalog's SemVer rules.

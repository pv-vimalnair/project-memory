import { describe, expect, it } from "vitest";

import { validateToolConfigDocument } from "../../src/cli/config.js";
import * as versionModule from "../../src/version.js";

function preMarkerConfig(): Readonly<Record<string, unknown>> {
  return {
    schema_version: "1.0.0",
    root_id: "ROOT-01J01000000000000000000000",
    memory_root: "docs/project-memory",
    profile_lock: "docs/project-memory/profile.lock.yaml",
    catalog_lock: "docs/project-memory/catalog.lock.json",
    hub: { kind: "local", repository: "." },
    policy: {
      require_clean_canonical_tree: true,
      generated_view_check: true,
      archive_secret_scan: true,
    },
  };
}

describe("repository contract configuration", () => {
  it("accepts the known pre-marker shape and exact current marker only", () => {
    const exports = versionModule as unknown as Readonly<Record<string, unknown>>;
    expect(exports.LEGACY_REPOSITORY_CONTRACT_VERSION).toBe("1.0.0");
    expect(exports.REPOSITORY_CONTRACT_VERSION).toBe("1.1.0");

    const legacy = validateToolConfigDocument(preMarkerConfig());
    expect(legacy).toMatchObject({ ok: true });
    if (legacy.ok) {
      expect(legacy.value.repository_contract_version).toBeUndefined();
    }

    expect(validateToolConfigDocument({
      ...preMarkerConfig(),
      repository_contract_version: "1.1.0",
    })).toMatchObject({ ok: true });
    expect(validateToolConfigDocument({
      ...preMarkerConfig(),
      repository_contract_version: "2.0.0",
    })).toMatchObject({ ok: false });
  });
});

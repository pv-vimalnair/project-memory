import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const PILOT_ROOT = new URL("../../../../docs/pilots/", import.meta.url);

async function pilot(name: string): Promise<string> {
  return readFile(new URL(name, PILOT_ROOT), "utf8");
}

describe("live pilot readiness handoffs", () => {
  it.each(["LIFEOF_PILOT.md", "DINO_ESCAPE_PILOT.md"])(
    "keeps %s prepared but unauthorized with complete safety gates",
    async (name) => {
      const document = await pilot(name);
      expect(document).toContain("PREPARED — NOT AUTHORIZED");
      expect(document).toContain("Read-only discovery");
      expect(document).toContain("Sensitive exclusions");
      expect(document).toContain("Approved scratch path");
      expect(document).toContain("Enduring root");
      expect(document).toContain("Workstreams, not roots");
      expect(document).toContain("Preflight");
      expect(document).toContain("Dry run");
      expect(document).toContain("Backup and rollback");
      expect(document).toContain("Acceptance checks");
      expect(document).toContain("LIVE_PILOT_APPROVAL.md");
      expect(document).toMatch(/explicit Pitaji approval/i);
      expect(document).toMatch(/git revert/i);
      expect(document).not.toMatch(/git reset --hard|git clean -[a-z]*f|rm -rf|Remove-Item|git push|deploy|publish/i);
    },
  );

  it("requires one non-transferable approval bound to the exact target and authority", async () => {
    const approval = await pilot("LIVE_PILOT_APPROVAL.md");
    expect(approval).toContain("TEMPLATE — NOT AN APPROVAL");
    for (const field of [
      "approval_id",
      "pilot_id",
      "repository",
      "expected_head",
      "branch",
      "isolated_worktree_path",
      "scope",
      "starts_at",
      "expires_at",
      "allowed_writes",
      "import_owner",
      "commit_permission",
      "rollback_permission",
      "approver",
      "approved_at",
    ]) {
      expect(approval).toContain(`${field}:`);
    }
    expect(approval).toContain("One approval authorizes exactly one pilot and one target");
    expect(approval).toContain("LifeOf approval does not authorize Dino Escape");
    expect(approval).toContain("Dino Escape approval does not authorize LifeOf");
    expect(approval).toContain("deployment, publication, production changes, external communication, or deletion");
    expect(approval).toContain("Placeholders invalidate approval");
  });

  it("makes preflight, dry run, backup, secret handling, acceptance, and approval mandatory", async () => {
    const documents = await Promise.all([
      pilot("LIFEOF_PILOT.md"),
      pilot("DINO_ESCAPE_PILOT.md"),
      pilot("LIVE_PILOT_APPROVAL.md"),
    ]);
    const joined = documents.join("\n");
    for (const requirement of [
      "preflight",
      "dry run",
      "backup",
      "rollback",
      "secret",
      "acceptance",
      "explicit approval",
    ]) {
      expect(joined.toLowerCase()).toContain(requirement);
    }
  });
});

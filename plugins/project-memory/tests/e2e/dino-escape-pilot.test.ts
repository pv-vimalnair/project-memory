import { afterAll, describe, expect, it } from "vitest";

import { cleanupPilotRoots, runProductRootPilot } from "./pilot-harness.js";

afterAll(cleanupPilotRoots);

describe("Dino Escape scratch pilot", () => {
  it("keeps Unity gameplay work as a workstream, never another root", async () => {
    const pilot = await runProductRootPilot({
      fixture: "dino-escape",
      initiative_id: "INIT-01J00000000000000000000201",
      workstream_id: "WS-01J00000000000000000000201",
      task_id: "TASK-01J00000000000000000000201",
      packet_id: "PKT-01J00000000000000000000201",
      claim_id: "CLAIM-01J00000000000000000000201",
      goal: "Validate responsive movement in the sanitized Unity scene",
      scope_glob: "Assets/**",
      changed_path: "Assets/Scripts/DinoController.cs",
      external_action: false,
    });

    expect(pilot.profile).toMatchObject({
      product: "Dino Escape",
      root_kind: "product",
      blueprint: "game.engine-unity",
    });
    expect(pilot.fixture_paths).toEqual(expect.arrayContaining([
      "ProjectSettings/ProjectVersion.txt",
      "Assets/Scripts/DinoController.cs",
    ]));
    expect(pilot.sensitive_findings).toEqual([]);
    expect(pilot.bootstrap_calls).toBe(1);
    expect(pilot.root_document_paths).toEqual(["docs/project-memory/project.yaml"]);
    expect(pilot.workstream_became_root).toBe(false);
    expect(pilot.task_status).toBe("integrated_verified");
    expect(pilot.completion_valid && pilot.archive_valid && pilot.views_valid).toBe(true);
    expect(pilot.history_is_append_only).toBe(true);
    expect(pilot.migration.finalize_calls).toBe(1);
    expect(pilot.import_run.finalize_calls).toBe(1);
    expect(pilot.import_run.commit_paths).toEqual(expect.arrayContaining([
      "docs/project-memory/source/PILOT_IMPORT.md",
      pilot.import_run.original_archive_path,
      pilot.import_run.report_path,
      pilot.import_run.audit_path,
      ...pilot.generated_view_paths,
    ]));
  }, 120_000);
});

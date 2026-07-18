import { afterAll, describe, expect, it } from "vitest";

import { cleanupPilotRoots, runProductRootPilot } from "./pilot-harness.js";

afterAll(cleanupPilotRoots);

describe("LifeOf scratch pilot", () => {
  it("keeps Flutter work inside one coordinator-owned product root", async () => {
    const pilot = await runProductRootPilot({
      fixture: "lifeof",
      initiative_id: "INIT-01J00000000000000000000101",
      workstream_id: "WS-01J00000000000000000000101",
      task_id: "TASK-01J00000000000000000000101",
      packet_id: "PKT-01J00000000000000000000101",
      claim_id: "CLAIM-01J00000000000000000000101",
      goal: "Preserve context across the sanitized LifeOf habit flow",
      scope_glob: "lib/**",
      changed_path: "lib/context_continuity.dart",
      external_action: false,
    });

    expect(pilot.profile).toMatchObject({
      product: "LifeOf",
      root_kind: "product",
      blueprint: "application.consumer-mobile",
    });
    expect(pilot.fixture_paths).toEqual(expect.arrayContaining(["pubspec.yaml", "lib/main.dart"]));
    expect(pilot.sensitive_findings).toEqual([]);
    expect(pilot.bootstrap_calls).toBe(1);
    expect(pilot.root_document_paths).toEqual(["docs/project-memory/project.yaml"]);
    expect(pilot.workstream_became_root).toBe(false);
    expect(pilot.selection_disposition).toBe("automatic");
    expect(pilot.task_status).toBe("integrated_verified");
    expect(pilot.claim_status).toBe("active");
    expect(pilot.completion_valid).toBe(true);
    expect(pilot.archive_valid).toBe(true);
    expect(pilot.views_valid).toBe(true);
    expect(pilot.history_is_append_only).toBe(true);
    expect(pilot.migration).toMatchObject({ exit_code: 0, plan_calls: 1, finalize_calls: 1 });
    expect(pilot.import_run).toMatchObject({ exit_code: 0, plan_calls: 1, finalize_calls: 1 });
    expect(pilot.import_run.commit_paths).toEqual(expect.arrayContaining([
      "docs/project-memory/source/PILOT_IMPORT.md",
      pilot.import_run.original_archive_path,
      pilot.import_run.report_path,
      pilot.import_run.audit_path,
      ...pilot.generated_view_paths,
    ]));
    expect(pilot.external_action).toEqual({ allowed: false, approval_ids: [], executed: false });
  }, 120_000);
});

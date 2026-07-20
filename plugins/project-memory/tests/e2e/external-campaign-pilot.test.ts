import { afterAll, describe, expect, it } from "vitest";

import { cleanupPilotRoots, runProductRootPilot } from "./pilot-harness.js";

afterAll(cleanupPilotRoots);

describe("external campaign scratch pilot", () => {
  it("binds campaign activation to one product task and performs no external action", async () => {
    const pilot = await runProductRootPilot({
      fixture: "external-campaign",
      initiative_id: "INIT-01J00000000000000000000301",
      workstream_id: "WS-01J00000000000000000000301",
      task_id: "TASK-01J00000000000000000000301",
      packet_id: "PKT-01J00000000000000000000301",
      claim_id: "CLAIM-01J00000000000000000000301",
      goal: "Prepare an approved in-product launch campaign",
      scope_glob: "src/**",
      changed_path: "src/campaign.ts",
      external_action: true,
    });

    expect(pilot.profile).toMatchObject({
      product: "Orbit App",
      root_kind: "product",
      external_action: "approval-required",
    });
    expect(pilot.root_document_paths).toEqual(["docs/project-memory/project.yaml"]);
    expect(pilot.workstream_became_root).toBe(false);
    expect(pilot.external_action).toMatchObject({
      allowed: true,
      executed: false,
      target: "production campaign",
      environment: "production",
      scope: ["campaign.launch"],
      timing: "once",
    });
    expect(pilot.external_action.approval_ids).toHaveLength(1);
    expect(pilot.completion_valid && pilot.archive_valid && pilot.views_valid).toBe(true);
    expect(pilot.migration).toMatchObject({ exit_code: 0, plan_calls: 1, finalize_calls: 1 });
    expect(pilot.import_run).toMatchObject({ exit_code: 0, plan_calls: 1, finalize_calls: 1 });
    expect(pilot.import_run.used_cli_lease_argument).toBe(false);
    expect(pilot.import_run.subsystem_has_direct_writer).toBe(false);
    expect(pilot.import_run.commit_paths).toEqual(expect.arrayContaining([
      "docs/project-memory/source/PILOT_IMPORT.md",
      pilot.import_run.original_archive_path,
      pilot.import_run.report_path,
      pilot.import_run.audit_path,
      ...pilot.generated_view_paths,
    ]));
    expect(pilot.task_status).toBe("integrated_verified");
    expect(pilot.history_is_append_only).toBe(true);
  }, 240_000);
});

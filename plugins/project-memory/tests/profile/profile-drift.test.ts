import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ResolvedProfile } from "../../src/profile/contracts/index.js";
import {
  inspectProfileDrift,
  type ObservedProfileEvidence,
} from "../../src/profile/profile-drift.js";
import { PROJECT_SCHEMA_REGISTRARS } from "../../src/schema/project-registrars.js";
import { registerProjectSchemas } from "../../src/schema/index.js";
import { resetSchemaRegistryForTests } from "../../src/schema/registry.js";
import { compileProductionProfilePlan } from "../helpers/production-profile-plan.js";

let acceptedProfile: ResolvedProfile;

const observedNewComponent: ObservedProfileEvidence = {
  observation_id: "observation.component.web-client",
  kind: "component",
  observed_id: "component.web-client",
  summary: "Repository evidence indicates a web client not present in the accepted profile.",
  evidence_refs: ["evidence:package-json", "evidence:src-web"],
};

beforeAll(async () => {
  resetSchemaRegistryForTests();
  const registered = registerProjectSchemas(PROJECT_SCHEMA_REGISTRARS);
  if (!registered.ok) throw new Error(JSON.stringify(registered.issues));
  acceptedProfile = (await compileProductionProfilePlan()).plan.metadata.profile;
});

afterAll(() => {
  resetSchemaRegistryForTests();
});

describe("observed profile drift boundary", () => {
  it("keeps observed repository reality outside accepted intent", () => {
    const before = JSON.stringify(acceptedProfile);
    const result = inspectProfileDrift(acceptedProfile, observedNewComponent);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.proposals).toEqual([
      expect.objectContaining({
        observation_id: observedNewComponent.observation_id,
        status: "observed_unclassified",
        required_action: "review-accepted-profile",
      }),
    ]);
    expect(result.value.writes).toEqual([]);
    expect("profile" in result.value).toBe(false);
    expect("accepted_sources" in result.value).toBe(false);
    expect(JSON.stringify(acceptedProfile)).toBe(before);
  });

  it("recognizes an observation already represented by accepted profile identity", () => {
    const adapter = acceptedProfile.adapters[0];
    expect(adapter).toBeDefined();
    if (adapter === undefined) return;
    const result = inspectProfileDrift(acceptedProfile, {
      observation_id: "observation.adapter.codex",
      kind: "adapter",
      observed_id: adapter.definition_id,
      summary: "Codex adapter signal is present.",
      evidence_refs: ["evidence:agents-md"],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.proposals).toEqual([]);
    expect(result.value.accepted_matches).toEqual([
      expect.objectContaining({ status: "accepted_match" }),
    ]);
  });

  it("sorts observations and evidence deterministically", () => {
    const second: ObservedProfileEvidence = {
      observation_id: "observation.domain.analytics",
      kind: "domain",
      observed_id: "domain.analytics",
      summary: "Analytics behavior is observed but not accepted.",
      evidence_refs: ["evidence:z", "evidence:a"],
    };
    const first = inspectProfileDrift(acceptedProfile, [
      observedNewComponent,
      second,
    ]);
    const reversed = inspectProfileDrift(acceptedProfile, [
      { ...second, evidence_refs: [...second.evidence_refs].reverse() },
      observedNewComponent,
    ]);
    expect(first).toEqual(reversed);
    if (!first.ok) throw new Error(JSON.stringify(first.issues));
    expect(first.value.proposals.map((proposal) => proposal.observation_id)).toEqual([
      "observation.component.web-client",
      "observation.domain.analytics",
    ]);
    expect(first.value.proposals[1]?.evidence_refs).toEqual([
      "evidence:a",
      "evidence:z",
    ]);
  });

  it("rejects duplicate observation identity instead of merging evidence silently", () => {
    const result = inspectProfileDrift(acceptedProfile, [
      observedNewComponent,
      { ...observedNewComponent, summary: "Conflicting interpretation." },
    ]);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_DRIFT_OBSERVATION_DUPLICATE" }],
    });
  });

  it("requires explicit evidence and never returns a mutation capability", () => {
    const result = inspectProfileDrift(acceptedProfile, {
      ...observedNewComponent,
      evidence_refs: [],
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PROFILE_DRIFT_EVIDENCE_REQUIRED" }],
    });
  });
});

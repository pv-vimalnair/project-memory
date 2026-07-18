import {
  failure,
  success,
} from "../../contracts/runtime-result.js";
import { decodeStrictUtf8 } from "../../core/document-io.js";
import type { MigrationDefinition } from "../contracts.js";

const LEGACY_HEADER = /^# generated_at: ([^\r\n]+)(\r?\n)/;
const NORMALIZED_HEADER = /^# generated_metadata: normalized(?:\r?\n)/;

export const normalizeGeneratedMetadataMigration: MigrationDefinition = {
  id: "normalize-generated-metadata",
  from_version: "1.0.0",
  to_version: "1.1.0",
  affected_artifacts: ["profile-lock"],
  authority_impact: "none",
  transform(input) {
    const decoded = decodeStrictUtf8(input.bytes, input.relative_path);
    if (!decoded.ok) return decoded;
    if (NORMALIZED_HEADER.test(decoded.value)) {
      return success({ bytes: new Uint8Array(input.bytes), semantic_diff: [] });
    }
    const match = LEGACY_HEADER.exec(decoded.value);
    if (match === null) {
      return failure(
        "MIGRATION_METADATA_HEADER_MISSING",
        "profile lock has neither legacy nor normalized generated metadata",
        input.relative_path,
      );
    }
    const generatedAt = match[1] ?? "";
    const newline = match[2] ?? "\n";
    const normalized = decoded.value.replace(
      LEGACY_HEADER,
      `# generated_metadata: normalized${newline}`,
    );
    return success({
      bytes: new TextEncoder().encode(normalized),
      semantic_diff: [{
        path: "/generated_metadata",
        before: generatedAt,
        after: "normalized",
      }],
    });
  },
};

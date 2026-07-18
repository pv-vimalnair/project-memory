import path from "node:path";

import type { Ajv2020 } from "ajv/dist/2020.js";
import { valid as validSemanticVersion } from "semver";

import { INSTANCE_ID_PATTERN } from "../contracts/ids.js";

const DEFINITION_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function registerProjectFormats(ajv: Ajv2020): void {
  ajv.addFormat("definition-id", {
    type: "string",
    validate: (value: string) => DEFINITION_ID_PATTERN.test(value),
  });
  ajv.addFormat("instance-id", {
    type: "string",
    validate: (value: string) => INSTANCE_ID_PATTERN.test(value),
  });
  ajv.addFormat("utc-timestamp", {
    type: "string",
    validate: (value: string) =>
      UTC_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value)),
  });
  ajv.addFormat("sha256", {
    type: "string",
    validate: (value: string) => SHA256_PATTERN.test(value),
  });
  ajv.addFormat("semantic-version", {
    type: "string",
    validate: (value: string) => validSemanticVersion(value) !== null,
  });
  ajv.addFormat("git-revision", {
    type: "string",
    validate: (value: string) => GIT_REVISION_PATTERN.test(value),
  });
  ajv.addFormat("safe-relative-path", {
    type: "string",
    validate: isSafeRelativePath,
  });
}

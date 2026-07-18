import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import {
  decodeStrictUtf8,
  emitGeneratedYaml,
  parseYamlDocument,
} from "../core/document-io.js";
import { resolveInside } from "../core/path-safety.js";
import { buildInitialSourceProposal } from "../cli/init/build-initial-source-proposal.js";

const MAX_EVIDENCE_BYTES = 1_048_576;
const STRUCTURED_BRIEF_CANDIDATES = [
  "PROJECT_MEMORY_BRIEF.yaml",
  "BRIEF.yaml",
  "BRIEF.yml",
  "BRIEF.md",
] as const;

export interface InferredRepositoryBrief {
  readonly brief_path: string;
  readonly brief_text: string;
  readonly source_paths: readonly string[];
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function optionalText(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<string | null>> {
  const target = await resolveInside(root, relativePath);
  if (!target.ok) return target;
  try {
    const stat = await lstat(target.value);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure(
        "AGENT_REPOSITORY_EVIDENCE_UNSAFE",
        "repository inference evidence must be a regular file",
        relativePath,
      );
    }
    if (stat.size > MAX_EVIDENCE_BYTES) {
      return failure(
        "AGENT_REPOSITORY_EVIDENCE_TOO_LARGE",
        "repository inference evidence exceeds the byte bound",
        relativePath,
      );
    }
    return decodeStrictUtf8(new Uint8Array(await readFile(target.value)), relativePath);
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? success(null)
      : failure(
          "AGENT_REPOSITORY_EVIDENCE_READ_FAILED",
          error instanceof Error ? error.message : String(error),
          relativePath,
        );
  }
}

async function optionalDirectory(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<boolean>> {
  const target = await resolveInside(root, relativePath);
  if (!target.ok) return target;
  try {
    const stat = await lstat(target.value);
    if (stat.isSymbolicLink()) {
      return failure(
        "AGENT_REPOSITORY_EVIDENCE_UNSAFE",
        "repository inference cannot follow a directory symlink",
        relativePath,
      );
    }
    return success(stat.isDirectory());
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? success(false)
      : failure(
          "AGENT_REPOSITORY_EVIDENCE_READ_FAILED",
          error instanceof Error ? error.message : String(error),
          relativePath,
        );
  }
}

function missionFrom(text: string): {
  readonly name: string | null;
  readonly mission: string | null;
} {
  const named = /^\s*[-*]\s+(?:His\s+)?mission:\s+\*\*([^*\r\n]+)\*\*\s*(?:\u2014|\u2013|\u00e2\u20ac\u201d|-|:)\s*(.+?)\s*$/imu.exec(text);
  const namedName = stringValue(named?.[1]);
  const namedMission = stringValue(named?.[2]);
  if (namedName !== null && namedMission !== null) {
    return { name: namedName, mission: namedMission };
  }
  const direct = /^\s*(?:[-*]\s*)?(?:product\s+)?mission:\s+(.+?)\s*$/imu.exec(text);
  return { name: null, mission: stringValue(direct?.[1]) };
}

function ownerFrom(text: string): string | null {
  const heading = /^#{1,6}\s+Master:\s*(.+?)\s*$/imu.exec(text);
  const owner = stringValue(heading?.[1]);
  return owner === null ? null : owner.replaceAll("**", "").trim();
}

function namespace(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return slug.length >= 3 ? slug : `project-${slug || "root"}`;
}

function humanName(value: string): string {
  return value
    .split(/[-_.]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function dependencyKeys(document: Readonly<Record<string, unknown>> | null): readonly string[] {
  const dependencies = record(document?.dependencies);
  return dependencies === null ? [] : Object.keys(dependencies).sort(compareUtf8);
}

async function conventionalBrief(root: URL): Promise<RuntimeResult<InferredRepositoryBrief | null>> {
  for (const relativePath of STRUCTURED_BRIEF_CANDIDATES) {
    const text = await optionalText(root, relativePath);
    if (!text.ok) return text;
    if (text.value === null) continue;
    const proposal = buildInitialSourceProposal({
      root,
      brief_path: relativePath,
      brief_text: text.value,
    });
    if (proposal.ok && proposal.value.unresolved_required_facts.length === 0) {
      return success({
        brief_path: relativePath,
        brief_text: text.value,
        source_paths: [relativePath],
      });
    }
  }
  return success(null);
}

export async function inferRepositoryBrief(
  root: URL,
): Promise<RuntimeResult<InferredRepositoryBrief>> {
  if (root.protocol !== "file:") {
    return failure("AGENT_ROOT_INVALID", "repository inference root must be a file URL", root.href);
  }

  const conventional = await conventionalBrief(root);
  if (!conventional.ok) return conventional;
  if (conventional.value !== null) return success(conventional.value);

  const sourcePaths = new Set<string>();
  const documents = new Map<string, string>();
  for (const relativePath of ["AGENTS.md", "CLAUDE.md", "README.md"] as const) {
    const text = await optionalText(root, relativePath);
    if (!text.ok) return text;
    if (text.value !== null) {
      documents.set(relativePath, text.value);
      sourcePaths.add(relativePath);
    }
  }

  const pubspecText = await optionalText(root, "pubspec.yaml");
  if (!pubspecText.ok) return pubspecText;
  let pubspec: Readonly<Record<string, unknown>> | null = null;
  if (pubspecText.value !== null) {
    const parsed = parseYamlDocument(pubspecText.value, "pubspec.yaml");
    if (!parsed.ok) return parsed;
    pubspec = record(parsed.value);
    if (pubspec === null) {
      return failure("AGENT_REPOSITORY_MANIFEST_INVALID", "pubspec.yaml must contain an object", "pubspec.yaml");
    }
    sourcePaths.add("pubspec.yaml");
  }

  const allText = [...documents.values()].join("\n");
  const mission = missionFrom(allText);
  const packageName = stringValue(pubspec?.name);
  const genericDescription = /^A new .+ project\.?$/iu;
  const packageDescription = stringValue(pubspec?.description);
  const resolvedMission = mission.mission ??
    (packageDescription !== null && !genericDescription.test(packageDescription)
      ? packageDescription
      : null);
  const resolvedName = mission.name ??
    (packageName === null
      ? humanName(path.basename(fileURLToPath(root)))
      : humanName(packageName));
  const owner = ownerFrom(allText);

  const dependencies = dependencyKeys(pubspec);
  const flutter = dependencies.includes("flutter");
  const runtimeAdapters = new Set<string>();
  if (flutter) runtimeAdapters.add("adapter.flutter");

  const firebaseFile = await optionalText(root, "firebase.json");
  if (!firebaseFile.ok) return firebaseFile;
  const firebase = firebaseFile.value !== null ||
    dependencies.some((item) => item.startsWith("firebase_"));
  if (firebase) {
    runtimeAdapters.add("adapter.firebase");
    if (firebaseFile.value !== null) sourcePaths.add("firebase.json");
  }

  for (const [relativePath, adapter] of [
    ["android", "adapter.android"],
    ["ios", "adapter.ios"],
  ] as const) {
    const present = await optionalDirectory(root, relativePath);
    if (!present.ok) return present;
    if (present.value) {
      runtimeAdapters.add(adapter);
      sourcePaths.add(relativePath);
    }
  }

  const workflowAdapters = new Set<string>();
  const workflowSignals = [
    ["figma", "adapter.figma"],
    ["maestro", "adapter.maestro"],
    ["notion", "adapter.notion"],
    ["playwright", "adapter.playwright"],
  ] as const;
  const lowerContext = allText.toLowerCase();
  for (const [signal, adapter] of workflowSignals) {
    if (lowerContext.includes(signal)) workflowAdapters.add(adapter);
  }

  const productShape = flutter ? "application.consumer-mobile" : null;
  const missing = [
    ...(resolvedMission === null ? ["mission"] : []),
    ...(owner === null ? ["owners"] : []),
    ...(productShape === null ? ["product_shape"] : []),
    ...(runtimeAdapters.size === 0 ? ["runtime_adapters"] : []),
  ];
  if (missing.length > 0) {
    return failure(
      "AGENT_REPOSITORY_CONTEXT_REQUIRED",
      `Please provide the missing initialization facts together: ${missing.join(", ")}.`,
      "repository",
      missing,
    );
  }

  const missionText = resolvedMission ?? "";
  const ownerText = owner ?? "";
  const shapeText = productShape?.replaceAll(/[.-]+/gu, " ") ?? "";
  const emitted = emitGeneratedYaml({
    name: resolvedName,
    mission: missionText,
    namespace: namespace(packageName ?? resolvedName),
    lifecycle: "active",
    owners: [ownerText],
    runtime_adapters: [...runtimeAdapters].sort(compareUtf8),
    workflow_adapters: [...workflowAdapters].sort(compareUtf8),
    success_criteria: [
      `The product continues to deliver its documented mission: ${missionText}`,
    ],
    included_scope: [
      `A durable ${shapeText} product: ${missionText}`,
    ],
    excluded_scope: [
      "Temporary campaigns, audits, redesigns, refactors, security checks, UI checks, UX checks, and marketing campaigns are workstreams, not separate project roots.",
    ],
  });
  if (!emitted.ok) return emitted;

  const sortedSources = [...sourcePaths].sort(compareUtf8);
  return success({
    brief_path: `inferred://repository/${sortedSources.map(encodeURIComponent).join("+")}`,
    brief_text: emitted.value,
    source_paths: sortedSources,
  });
}

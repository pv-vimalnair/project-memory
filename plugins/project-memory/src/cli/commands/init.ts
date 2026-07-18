import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CanonicalRecord } from "../../governance/contracts/index.js";
import type { BootstrapFinalization } from "../../governance/integration/bootstrap-finalizer.js";
import {
  failure,
  success,
  type RuntimeResult,
} from "../../contracts/runtime-result.js";
import {
  decodeStrictUtf8,
  parseJsonDocument,
} from "../../core/document-io.js";
import type { CliCommand } from "../command-registry.js";
import {
  buildInitPlan,
  serializeInitPlan,
  type InitPlan,
  type InitReplayInput,
} from "../init/build-init-plan.js";
import type { InitApplyInput } from "../init/apply-init-plan.js";

export interface InitCommandDependencies {
  readonly build_plan: (replay: InitReplayInput) => Promise<RuntimeResult<InitPlan>>;
  readonly apply_plan: (input: InitApplyInput) => Promise<RuntimeResult<BootstrapFinalization>>;
  readonly now?: () => Date;
  readonly read_json?: (url: URL) => Promise<RuntimeResult<unknown>>;
  readonly write_plan?: (url: URL, plan: InitPlan) => Promise<RuntimeResult<true>>;
}

function requiredFlag(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): RuntimeResult<string> {
  const value = flags[name];
  return typeof value === "string"
    ? success(value)
    : failure("CLI_FLAG_REQUIRED", `--${name} is required`, name);
}

function rootUrl(value: string, currentDirectory: URL): RuntimeResult<URL> {
  if (currentDirectory.protocol !== "file:") {
    return failure("CLI_ROOT_INVALID", "current directory must be a file URL");
  }
  try {
    const target = value.startsWith("file:")
      ? fileURLToPath(new URL(value))
      : path.resolve(fileURLToPath(currentDirectory), value);
    return success(pathToFileURL(`${target}${path.sep}`));
  } catch (error: unknown) {
    return failure("CLI_ROOT_INVALID", error instanceof Error ? error.message : String(error), value);
  }
}

function fileUrl(value: string, currentDirectory: URL): RuntimeResult<URL> {
  if (currentDirectory.protocol !== "file:") {
    return failure("CLI_PATH_INVALID", "current directory must be a file URL");
  }
  try {
    return success(value.startsWith("file:")
      ? new URL(value)
      : pathToFileURL(path.resolve(fileURLToPath(currentDirectory), value)));
  } catch (error: unknown) {
    return failure("CLI_PATH_INVALID", error instanceof Error ? error.message : String(error), value);
  }
}

function reviveSerializedBytes(value: unknown, source: string): RuntimeResult<unknown> {
  if (Array.isArray(value)) {
    const revived: unknown[] = [];
    for (const item of value) {
      const result = reviveSerializedBytes(item, source);
      if (!result.ok) return result;
      revived.push(result.value);
    }
    return success(revived);
  }
  if (typeof value !== "object" || value === null) return success(value);
  const entries = Object.entries(value as Readonly<Record<string, unknown>>);
  if (entries.length === 1 && entries[0]?.[0] === "bytes_base64") {
    const encoded = entries[0][1];
    if (typeof encoded !== "string") {
      return failure("CLI_INPUT_BYTES_INVALID", "serialized bytes must contain canonical base64", source);
    }
    const bytes = Buffer.from(encoded, "base64");
    return bytes.toString("base64") === encoded
      ? success(new Uint8Array(bytes))
      : failure("CLI_INPUT_BYTES_INVALID", "serialized bytes must contain canonical base64", source);
  }
  const revived: Record<string, unknown> = {};
  for (const [name, item] of entries) {
    const result = reviveSerializedBytes(item, source);
    if (!result.ok) return result;
    revived[name] = result.value;
  }
  return success(revived);
}
async function defaultReadJson(url: URL): Promise<RuntimeResult<unknown>> {
  try {
    const stat = await lstat(url);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return failure("CLI_INPUT_UNSAFE", "CLI input must be a regular file", url.href);
    }
    const decoded = decodeStrictUtf8(new Uint8Array(await readFile(url)), url.href);
    if (!decoded.ok) return decoded;
    const parsed = parseJsonDocument(decoded.value, url.href);
    return parsed.ok ? reviveSerializedBytes(parsed.value, url.href) : parsed;
  } catch (error: unknown) {
    return failure("CLI_INPUT_READ_FAILED", error instanceof Error ? error.message : String(error), url.href);
  }
}

async function defaultWritePlan(url: URL, plan: InitPlan): Promise<RuntimeResult<true>> {
  try {
    await mkdir(path.dirname(fileURLToPath(url)), { recursive: true });
    await writeFile(url, `${serializeInitPlan(plan)}\n`, { encoding: "utf8", flag: "wx" });
    return success(true);
  } catch (error: unknown) {
    return failure(
      (error as NodeJS.ErrnoException).code === "EEXIST"
        ? "CLI_OUTPUT_EXISTS"
        : "CLI_OUTPUT_WRITE_FAILED",
      error instanceof Error ? error.message : String(error),
      url.href,
    );
  }
}

function isInitPlan(value: unknown): value is InitPlan {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).schema_version === "1.0.0" &&
    typeof (value as Record<string, unknown>).plan_hash === "string" &&
    typeof (value as Record<string, unknown>).replay === "object";
}

function isCanonicalRecord(value: unknown): value is CanonicalRecord {
  return typeof value === "object" && value !== null &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).type === "string";
}

function defaultDependencies(): InitCommandDependencies {
  return {
    build_plan: (replay) => buildInitPlan(replay),
    apply_plan: () => Promise.resolve(failure(
      "INIT_COORDINATOR_REQUIRED",
      "init apply requires the host runtime to provide its IntegrationCoordinator",
    )),
  };
}

export function createInitCommands(
  dependencies: InitCommandDependencies = defaultDependencies(),
): readonly CliCommand[] {
  const now = dependencies.now ?? (() => new Date());
  const readJson = dependencies.read_json ?? defaultReadJson;
  const writePlan = dependencies.write_plan ?? defaultWritePlan;
  const planCommand: CliCommand<InitPlan> = {
    path: ["init", "plan"],
    mutates: false,
    async run(context, invocation) {
      const rootFlag = requiredFlag(invocation.flags, "root");
      if (!rootFlag.ok) return rootFlag;
      const brief = requiredFlag(invocation.flags, "brief");
      if (!brief.ok) return brief;
      const catalog = requiredFlag(invocation.flags, "catalog");
      if (!catalog.ok) return catalog;
      const adapter = requiredFlag(invocation.flags, "agent-adapter");
      if (!adapter.ok) return adapter;
      const root = rootUrl(rootFlag.value, context.current_directory);
      if (!root.ok) return root;
      const catalogPath = fileUrl(catalog.value, context.current_directory);
      if (!catalogPath.ok) return catalogPath;
      const created = now();
      if (!Number.isFinite(created.getTime())) {
        return failure("CLI_CLOCK_INVALID", "initialization clock must be valid");
      }
      const planned = await dependencies.build_plan({
        root: root.value.href,
        brief_path: brief.value,
        catalog_bundle_path: catalogPath.value.href,
        agent_adapter: adapter.value,
        target_ref: typeof invocation.flags["target-ref"] === "string"
          ? invocation.flags["target-ref"]
          : "refs/heads/main",
        created_at: created.toISOString(),
        expires_at: new Date(created.getTime() + 60 * 60 * 1000).toISOString(),
      });
      if (!planned.ok) return planned;
      const output = invocation.flags.output;
      if (typeof output === "string") {
        const outputUrl = fileUrl(output, context.current_directory);
        if (!outputUrl.ok) return outputUrl;
        const written = await writePlan(outputUrl.value, planned.value);
        if (!written.ok) return written;
      }
      return success(
        planned.value,
        planned.warnings.some((warning) => warning.severity === "review")
          ? planned.warnings
          : [
              ...planned.warnings,
              {
                code: "INIT_PITAJI_APPROVAL_REQUIRED",
                severity: "review",
                path: "approval",
                message: "Pitaji must approve the exact initialization plan before apply",
                references: [],
              },
            ],
      );
    },
  };

  const applyCommand: CliCommand<BootstrapFinalization> = {
    path: ["init", "apply"],
    mutates: true,
    async run(context, invocation) {
      const planFlag = requiredFlag(invocation.flags, "plan");
      if (!planFlag.ok) return planFlag;
      const approvalFlag = requiredFlag(invocation.flags, "approval");
      if (!approvalFlag.ok) return approvalFlag;
      const planUrl = fileUrl(planFlag.value, context.current_directory);
      if (!planUrl.ok) return planUrl;
      const approvalUrl = fileUrl(approvalFlag.value, context.current_directory);
      if (!approvalUrl.ok) return approvalUrl;
      const saved = await readJson(planUrl.value);
      if (!saved.ok) return saved;
      if (!isInitPlan(saved.value)) {
        return failure("INIT_PLAN_INVALID", "saved initialization plan has an incompatible shape", planUrl.value.href);
      }
      const approval = await readJson(approvalUrl.value);
      if (!approval.ok) return approval;
      if (!isCanonicalRecord(approval.value)) {
        return failure("INIT_APPROVAL_INVALID", "approval input has an incompatible shape", approvalUrl.value.href);
      }
      return dependencies.apply_plan({ saved_plan: saved.value, approval_record: approval.value });
    },
  };
  return [planCommand, applyCommand];
}

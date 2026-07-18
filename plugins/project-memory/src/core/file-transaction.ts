import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PlannedWrite } from "../contracts/planned-write.js";
import {
  failure,
  success,
  type RuntimeIssue,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { SystemClock, type Clock } from "./clock.js";
import { sha256 } from "./hash.js";
import { MonotonicIdFactory, type IdFactory } from "./id-factory.js";
import { resolveInside } from "./path-safety.js";

export interface FileTransactionReport {
  readonly transaction_id: string;
  readonly recovered_prior_attempt: boolean;
  readonly writes: readonly {
    readonly relative_path: string;
    readonly previous_sha256: string | null;
    readonly next_sha256: string;
  }[];
}

export interface TransactionFileSystem {
  readFile(file: URL): Promise<Uint8Array>;
  writeFile(file: URL, bytes: Uint8Array): Promise<void>;
  mkdir(directory: URL): Promise<void>;
  rename(from: URL, to: URL): Promise<void>;
  remove(target: URL): Promise<void>;
  exists(target: URL): Promise<boolean>;
  list(directory: URL): Promise<readonly string[]>;
  syncFile(file: URL): Promise<void>;
}

export interface FileTransactionDependencies {
  readonly fs: TransactionFileSystem;
  readonly clock: Clock;
  readonly ids: IdFactory;
}

export interface FileTransactionValidation {
  validate(): Promise<RuntimeResult<true>>;
}

function defaultDependencies(): FileTransactionDependencies {
  const clock = new SystemClock();
  return {
    fs: new NodeTransactionFileSystem(),
    clock,
    ids: new MonotonicIdFactory(clock),
  };
}

export class NodeTransactionFileSystem implements TransactionFileSystem {
  async readFile(file: URL): Promise<Uint8Array> {
    return new Uint8Array(await readFile(file));
  }

  async writeFile(file: URL, bytes: Uint8Array): Promise<void> {
    await writeFile(file, bytes);
  }

  async mkdir(directory: URL): Promise<void> {
    await mkdir(directory, { recursive: true });
  }

  async rename(from: URL, to: URL): Promise<void> {
    await rename(from, to);
  }

  async remove(target: URL): Promise<void> {
    await rm(target, { recursive: true, force: true });
  }

  async exists(target: URL): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async list(directory: URL): Promise<readonly string[]> {
    try {
      return await readdir(directory);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async syncFile(file: URL): Promise<void> {
    const handle = await open(file, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

interface PreparedWrite {
  readonly write: PlannedWrite;
  readonly target: URL;
  readonly had_existing: boolean;
  readonly previous_sha256: string | null;
  readonly next_sha256: string;
}

interface JournalEntry {
  readonly relative_path: string;
  readonly staged_relative: string;
  readonly backup_relative: string;
  readonly had_existing: boolean;
}

interface TransactionJournal {
  readonly version: 1;
  readonly transaction_id: string;
  status: "staged" | "committing" | "complete";
  active_index: number;
  readonly created_at: string;
  readonly entries: readonly JournalEntry[];
}

const TRANSACTION_BASE = ".tmp/project-memory-transactions";
const TRANSACTION_ID_PATTERN = /^CHG-[0-9A-HJKMNP-TV-Z]{26}$/;

function parentUrl(file: URL): URL {
  return pathToFileURL(`${path.dirname(fileURLToPath(file))}${path.sep}`);
}

function issue(code: string, pathValue: string, message: string): RuntimeIssue {
  return {
    code,
    severity: "error",
    path: pathValue,
    message,
    references: [],
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function confined(root: URL, relativePath: string): Promise<URL> {
  const result = await resolveInside(root, relativePath);
  if (!result.ok) {
    throw new Error(result.issues.map((entry) => entry.message).join("; "));
  }
  return result.value;
}

function normalizedTargetKey(target: URL): string {
  const value = path.resolve(fileURLToPath(target));
  return process.platform === "win32" ? value.toLowerCase() : value;
}

async function prepareWrites(
  root: URL,
  writes: readonly PlannedWrite[],
  fs: TransactionFileSystem,
): Promise<RuntimeResult<readonly PreparedWrite[]>> {
  if (writes.length === 0) {
    return failure("TRANSACTION_EMPTY", "a file transaction requires at least one write");
  }

  const prepared: PreparedWrite[] = [];
  const targets = new Set<string>();
  for (const write of writes) {
    const resolved = await resolveInside(root, write.relative_path);
    if (!resolved.ok) return resolved;
    const targetKey = normalizedTargetKey(resolved.value);
    if (targets.has(targetKey)) {
      return failure(
        "TRANSACTION_DUPLICATE_PATH",
        "multiple writes resolve to the same target",
        write.relative_path,
      );
    }
    targets.add(targetKey);

    const hadExisting = await fs.exists(resolved.value);
    const previousBytes = hadExisting ? await fs.readFile(resolved.value) : null;
    const previousSha = previousBytes === null ? null : sha256(previousBytes);
    const invalidMode =
      (write.mode === "create" && hadExisting) ||
      (write.mode === "replace" && !hadExisting);
    const invalidHash =
      write.expected_existing_sha256 !== null &&
      write.expected_existing_sha256 !== previousSha;
    const missingReplaceHash =
      write.mode === "replace" && write.expected_existing_sha256 === null;
    if (invalidMode || invalidHash || missingReplaceHash) {
      return failure(
        "TRANSACTION_PRECONDITION_FAILED",
        "write mode or expected pre-image hash does not match the target",
        write.relative_path,
      );
    }

    prepared.push({
      write,
      target: resolved.value,
      had_existing: hadExisting,
      previous_sha256: previousSha,
      next_sha256: sha256(write.bytes),
    });
  }
  return success(prepared);
}

function serializeJournal(journal: TransactionJournal): Uint8Array {
  return Buffer.from(`${JSON.stringify(journal)}\n`, "utf8");
}

async function writeJournal(
  fs: TransactionFileSystem,
  journalUrl: URL,
  journal: TransactionJournal,
): Promise<void> {
  await fs.writeFile(journalUrl, serializeJournal(journal));
  await fs.syncFile(journalUrl);
}

function parseJournal(value: unknown, expectedId: string): TransactionJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("transaction journal must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.transaction_id !== expectedId ||
    !Array.isArray(record.entries) ||
    !Number.isInteger(record.active_index)
  ) {
    throw new Error("transaction journal header is invalid");
  }
  const entries: JournalEntry[] = record.entries.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("transaction journal entry must be an object");
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.relative_path !== "string" ||
      typeof item.staged_relative !== "string" ||
      typeof item.backup_relative !== "string" ||
      typeof item.had_existing !== "boolean"
    ) {
      throw new Error("transaction journal entry is invalid");
    }
    return {
      relative_path: item.relative_path,
      staged_relative: item.staged_relative,
      backup_relative: item.backup_relative,
      had_existing: item.had_existing,
    };
  });
  const status = record.status;
  if (status !== "staged" && status !== "committing" && status !== "complete") {
    throw new Error("transaction journal status is invalid");
  }
  return {
    version: 1,
    transaction_id: expectedId,
    status,
    active_index: record.active_index as number,
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    entries,
  };
}

async function rollbackJournal(
  root: URL,
  transactionRoot: string,
  journal: TransactionJournal,
  fs: TransactionFileSystem,
): Promise<void> {
  for (let index = journal.active_index; index >= 0; index -= 1) {
    const entry = journal.entries[index];
    if (entry === undefined) throw new Error("transaction journal index is invalid");
    const target = await confined(root, entry.relative_path);
    const backup = await confined(root, `${transactionRoot}/${entry.backup_relative}`);
    const backupExists = await fs.exists(backup);
    if (entry.had_existing && backupExists) {
      if (await fs.exists(target)) await fs.remove(target);
      await fs.mkdir(parentUrl(target));
      await fs.rename(backup, target);
      await fs.syncFile(target);
    } else if (!entry.had_existing && (await fs.exists(target))) {
      await fs.remove(target);
    }
  }
}

async function recoverPriorTransactions(
  root: URL,
  fs: TransactionFileSystem,
): Promise<boolean> {
  const base = await confined(root, TRANSACTION_BASE);
  const names = [...(await fs.list(base))].sort();
  let recovered = false;
  for (const name of names) {
    if (!TRANSACTION_ID_PATTERN.test(name)) {
      throw new Error(`unrecognized transaction directory: ${name}`);
    }
    const transactionRoot = `${TRANSACTION_BASE}/${name}`;
    const journalUrl = await confined(root, `${transactionRoot}/journal.json`);
    if (!(await fs.exists(journalUrl))) {
      throw new Error(`transaction journal is missing: ${name}`);
    }
    const journalText = Buffer.from(await fs.readFile(journalUrl)).toString("utf8");
    const parsed = JSON.parse(journalText) as unknown;
    const journal = parseJournal(parsed, name);
    if (journal.status !== "complete") {
      await rollbackJournal(root, transactionRoot, journal, fs);
      recovered = true;
    }
    const transactionUrl = await confined(root, transactionRoot);
    await fs.remove(transactionUrl);
  }
  return recovered;
}

export async function applyFileTransaction(
  root: URL,
  writes: readonly PlannedWrite[],
  dependencies: FileTransactionDependencies = defaultDependencies(),
  validation?: FileTransactionValidation,
): Promise<RuntimeResult<FileTransactionReport>> {
  let recoveredPriorAttempt: boolean;
  try {
    recoveredPriorAttempt = await recoverPriorTransactions(root, dependencies.fs);
  } catch (error: unknown) {
    return failure(
      "TRANSACTION_RECOVERY_FAILED",
      describeError(error),
      TRANSACTION_BASE,
    );
  }

  let prepared: RuntimeResult<readonly PreparedWrite[]>;
  try {
    prepared = await prepareWrites(root, writes, dependencies.fs);
  } catch (error: unknown) {
    return failure("TRANSACTION_PREPARE_FAILED", describeError(error));
  }
  if (!prepared.ok) return prepared;

  const transactionId = dependencies.ids.next("CHG");
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) {
    return failure("TRANSACTION_ID_INVALID", "IdFactory returned an invalid CHG identifier");
  }
  const transactionRoot = `${TRANSACTION_BASE}/${transactionId}`;
  let transactionUrl: URL | undefined;
  let journal: TransactionJournal | undefined;
  let validationIssues: readonly RuntimeIssue[] | undefined;
  let validationWarnings: readonly RuntimeIssue[] = [];

  try {
    transactionUrl = await confined(root, transactionRoot);
    const stagedRoot = await confined(root, `${transactionRoot}/staged`);
    const backupRoot = await confined(root, `${transactionRoot}/backups`);
    const journalUrl = await confined(root, `${transactionRoot}/journal.json`);
    await dependencies.fs.mkdir(stagedRoot);
    await dependencies.fs.mkdir(backupRoot);

    const entries: JournalEntry[] = [];
    for (let index = 0; index < prepared.value.length; index += 1) {
      const item = prepared.value[index];
      if (item === undefined) throw new Error("prepared write index is missing");
      const stagedRelative = `staged/${String(index)}`;
      const staged = await confined(root, `${transactionRoot}/${stagedRelative}`);
      await dependencies.fs.writeFile(staged, item.write.bytes);
      await dependencies.fs.syncFile(staged);
      entries.push({
        relative_path: item.write.relative_path,
        staged_relative: stagedRelative,
        backup_relative: `backups/${String(index)}`,
        had_existing: item.had_existing,
      });
    }

    journal = {
      version: 1,
      transaction_id: transactionId,
      status: "staged",
      active_index: -1,
      created_at: dependencies.clock.now().toISOString(),
      entries,
    };
    await writeJournal(dependencies.fs, journalUrl, journal);

    for (let index = 0; index < prepared.value.length; index += 1) {
      const item = prepared.value[index];
      const entry = entries[index];
      if (item === undefined || entry === undefined) {
        throw new Error("transaction entry index is missing");
      }
      journal.status = "committing";
      journal.active_index = index;
      await writeJournal(dependencies.fs, journalUrl, journal);

      const staged = await confined(root, `${transactionRoot}/${entry.staged_relative}`);
      const backup = await confined(root, `${transactionRoot}/${entry.backup_relative}`);
      await dependencies.fs.mkdir(parentUrl(item.target));
      if (item.had_existing) await dependencies.fs.rename(item.target, backup);
      await dependencies.fs.rename(staged, item.target);
      await dependencies.fs.syncFile(item.target);
    }

    if (validation !== undefined) {
      const validated = await validation.validate();
      if (!validated.ok) {
        validationIssues = validated.issues;
        throw new Error("post-write transaction validation failed");
      }
      validationWarnings = validated.warnings;
    }

    journal.status = "complete";
    await writeJournal(dependencies.fs, journalUrl, journal);
    await dependencies.fs.remove(transactionUrl);
    return success({
      transaction_id: transactionId,
      recovered_prior_attempt: recoveredPriorAttempt,
      writes: prepared.value.map((item) => ({
        relative_path: item.write.relative_path,
        previous_sha256: item.previous_sha256,
        next_sha256: item.next_sha256,
      })),
    }, validationWarnings);
  } catch (error: unknown) {
    const issues: RuntimeIssue[] = validationIssues === undefined
      ? [issue("TRANSACTION_FAILED", "", describeError(error))]
      : [...validationIssues];
    if (transactionUrl !== undefined) {
      try {
        if (journal !== undefined && journal.active_index >= 0) {
          await rollbackJournal(root, transactionRoot, journal, dependencies.fs);
        }
        await dependencies.fs.remove(transactionUrl);
      } catch (rollbackError: unknown) {
        issues.push(
          issue(
            "TRANSACTION_ROLLBACK_FAILED",
            transactionRoot,
            describeError(rollbackError),
          ),
        );
      }
    }
    return { ok: false, issues };
  }
}

export async function writeFileAtomic(
  root: URL,
  write: PlannedWrite,
  dependencies?: FileTransactionDependencies,
): Promise<RuntimeResult<FileTransactionReport>> {
  return applyFileTransaction(root, [write], dependencies);
}

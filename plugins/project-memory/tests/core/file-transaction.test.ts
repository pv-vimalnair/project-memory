import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlannedWrite } from "../../src/contracts/planned-write.js";
import { failure } from "../../src/contracts/runtime-result.js";
import type { Clock } from "../../src/core/clock.js";
import {
  applyFileTransaction,
  NodeTransactionFileSystem,
  type TransactionFileSystem,
  writeFileAtomic,
} from "../../src/core/file-transaction.js";
import { sha256 } from "../../src/core/hash.js";
import type { IdFactory } from "../../src/core/id-factory.js";

const fixedClock: Clock = {
  now: () => new Date("2026-07-14T12:00:00.000Z"),
};

let idCounter = 0;
const fixedIds: IdFactory = {
  next: (prefix) => {
    idCounter += 1;
    return `${prefix}-01J0000000000000000000000${String(idCounter)}`;
  },
};

class FaultInjectingFileSystem implements TransactionFileSystem {
  readonly #delegate = new NodeTransactionFileSystem();
  #writes = 0;
  #renames = 0;

  constructor(
    private readonly failure: {
      readonly write?: number;
      readonly rename?: number;
    },
  ) {}

  async readFile(file: URL): Promise<Uint8Array> {
    return this.#delegate.readFile(file);
  }

  async writeFile(file: URL, bytes: Uint8Array): Promise<void> {
    this.#writes += 1;
    if (this.#writes === this.failure.write) throw new Error("injected write failure");
    await this.#delegate.writeFile(file, bytes);
  }

  async mkdir(directory: URL): Promise<void> {
    await this.#delegate.mkdir(directory);
  }

  async rename(from: URL, to: URL): Promise<void> {
    this.#renames += 1;
    if (this.#renames === this.failure.rename) throw new Error("injected rename failure");
    await this.#delegate.rename(from, to);
  }

  async remove(target: URL): Promise<void> {
    await this.#delegate.remove(target);
  }

  async exists(target: URL): Promise<boolean> {
    return this.#delegate.exists(target);
  }

  async list(directory: URL): Promise<readonly string[]> {
    return this.#delegate.list(directory);
  }

  async syncFile(file: URL): Promise<void> {
    await this.#delegate.syncFile(file);
  }
}

let temporaryRoot = "";
let root: URL;

beforeEach(async () => {
  idCounter = 0;
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "project-memory-transaction-"));
  root = pathToFileURL(`${temporaryRoot}${path.sep}`);
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

function create(relativePath: string, value: string): PlannedWrite {
  return {
    relative_path: relativePath,
    bytes: Buffer.from(value, "utf8"),
    expected_existing_sha256: null,
    mode: "create",
  };
}

function replace(relativePath: string, before: string, after: string): PlannedWrite {
  return {
    relative_path: relativePath,
    bytes: Buffer.from(after, "utf8"),
    expected_existing_sha256: sha256(before),
    mode: "replace",
  };
}

async function transactionTemps(): Promise<readonly string[]> {
  try {
    return await readdir(
      path.join(temporaryRoot, ".tmp", "project-memory-transactions"),
    );
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("applyFileTransaction", () => {
  it("commits multiple files and reports hashes", async () => {
    const result = await applyFileTransaction(
      root,
      [create("one.txt", "one\n"), create("nested/two.txt", "two\n")],
      { fs: new NodeTransactionFileSystem(), clock: fixedClock, ids: fixedIds },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.writes).toHaveLength(2);
      expect(result.value.recovered_prior_attempt).toBe(false);
    }
    expect(await readFile(path.join(temporaryRoot, "one.txt"), "utf8")).toBe("one\n");
    expect(await readFile(path.join(temporaryRoot, "nested", "two.txt"), "utf8")).toBe("two\n");
    expect(await transactionTemps()).toEqual([]);
  });

  it("rejects duplicate normalized paths", async () => {
    const result = await applyFileTransaction(
      root,
      [create("same.txt", "one"), create("nested/../same.txt", "two")],
      { fs: new NodeTransactionFileSystem(), clock: fixedClock, ids: fixedIds },
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "TRANSACTION_DUPLICATE_PATH" }],
    });
  });

  it("rejects a stale precondition without changing the file", async () => {
    await writeFile(path.join(temporaryRoot, "existing.txt"), "current\n");
    const stale = replace("existing.txt", "older\n", "after\n");

    const result = await applyFileTransaction(root, [stale], {
      fs: new NodeTransactionFileSystem(),
      clock: fixedClock,
      ids: fixedIds,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "TRANSACTION_PRECONDITION_FAILED" }],
    });
    expect(await readFile(path.join(temporaryRoot, "existing.txt"), "utf8")).toBe("current\n");
  });

  it("leaves targets absent when the second staged write fails", async () => {
    const result = await applyFileTransaction(
      root,
      [create("one.txt", "one"), create("two.txt", "two")],
      { fs: new FaultInjectingFileSystem({ write: 2 }), clock: fixedClock, ids: fixedIds },
    );

    expect(result.ok).toBe(false);
    await expect(readFile(path.join(temporaryRoot, "one.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await transactionTemps()).toEqual([]);
  });

  it("restores prior bytes when a target rename fails", async () => {
    await writeFile(path.join(temporaryRoot, "existing.txt"), "before\n");
    const result = await applyFileTransaction(
      root,
      [replace("existing.txt", "before\n", "after\n")],
      { fs: new FaultInjectingFileSystem({ rename: 2 }), clock: fixedClock, ids: fixedIds },
    );

    expect(result.ok).toBe(false);
    expect(await readFile(path.join(temporaryRoot, "existing.txt"), "utf8")).toBe("before\n");
    expect(await transactionTemps()).toEqual([]);
  });


  it("rolls back all targets when post-write validation rejects", async () => {
    await writeFile(path.join(temporaryRoot, "existing.txt"), "before\n");
    const result = await applyFileTransaction(
      root,
      [
        replace("existing.txt", "before\n", "after\n"),
        create("created.txt", "created\n"),
      ],
      { fs: new NodeTransactionFileSystem(), clock: fixedClock, ids: fixedIds },
      {
        validate: async () => {
          expect(await readFile(path.join(temporaryRoot, "existing.txt"), "utf8"))
            .toBe("after\n");
          return failure("TRANSACTION_VALIDATION_REJECTED", "test rejection");
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "TRANSACTION_VALIDATION_REJECTED" }],
    });
    expect(await readFile(path.join(temporaryRoot, "existing.txt"), "utf8"))
      .toBe("before\n");
    await expect(readFile(path.join(temporaryRoot, "created.txt")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await transactionTemps()).toEqual([]);
  });
  it("recovers an incomplete durable journal before a new transaction", async () => {
    const transactionId = "CHG-01J00000000000000000000000";
    const transactionRoot = path.join(
      temporaryRoot,
      ".tmp",
      "project-memory-transactions",
      transactionId,
    );
    await mkdir(path.join(transactionRoot, "backups"), { recursive: true });
    await mkdir(path.join(transactionRoot, "staged"), { recursive: true });
    await writeFile(path.join(temporaryRoot, "recover.txt"), "partial-new\n");
    await writeFile(path.join(transactionRoot, "backups", "0"), "prior\n");
    await writeFile(
      path.join(transactionRoot, "journal.json"),
      JSON.stringify({
        version: 1,
        transaction_id: transactionId,
        status: "committing",
        active_index: 0,
        entries: [{
          relative_path: "recover.txt",
          staged_relative: "staged/0",
          backup_relative: "backups/0",
          had_existing: true,
        }],
      }),
    );

    const result = await applyFileTransaction(root, [create("after.txt", "after\n")], {
      fs: new NodeTransactionFileSystem(),
      clock: fixedClock,
      ids: fixedIds,
    });

    expect(result.ok && result.value.recovered_prior_attempt).toBe(true);
    expect(await readFile(path.join(temporaryRoot, "recover.txt"), "utf8")).toBe("prior\n");
    expect(await transactionTemps()).toEqual([]);
  });

  it("uses the transaction protocol for one atomic write", async () => {
    const result = await writeFileAtomic(root, create("single.txt", "single\n"), {
      fs: new NodeTransactionFileSystem(),
      clock: fixedClock,
      ids: fixedIds,
    });

    expect(result.ok && result.value.writes).toHaveLength(1);
    expect(await readFile(path.join(temporaryRoot, "single.txt"), "utf8")).toBe("single\n");
  });
});

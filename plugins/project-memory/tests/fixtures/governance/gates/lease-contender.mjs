import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [commonGitDir, acquiredAt] = process.argv.slice(2);
if (commonGitDir === undefined || acquiredAt === undefined) {
  throw new Error("usage: lease-contender.mjs <common-git-dir> <acquired-at>");
}

const projectMemory = path.join(commonGitDir, "project-memory");
const mutex = path.join(projectMemory, "integration-lease.mutex");
await mkdir(projectMemory, { recursive: true });
await mkdir(mutex);
await writeFile(
  path.join(mutex, "owner.json"),
  JSON.stringify({
    holder_id: "crashed-contender",
    nonce: "c".repeat(64),
    acquired_at: acquiredAt,
    expires_at: new Date(Date.parse(acquiredAt) + 30_000).toISOString(),
  }),
  { flag: "wx" },
);
process.stdout.write("mutex-acquired\n");
setInterval(() => {}, 60_000);

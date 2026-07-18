import { createHash } from "node:crypto";

export function sha256(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return createHash("sha256").update(bytes).digest("hex");
}

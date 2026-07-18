import type { RuntimeResult } from "../../src/index.js";

export function mustValue<T>(result: RuntimeResult<T>): T {
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.code).join(","));
  }
  return result.value;
}

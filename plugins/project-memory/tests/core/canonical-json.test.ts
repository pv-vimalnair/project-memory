import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";

function fixture(name: string): unknown {
  const url = new URL(`../fixtures/canonical-json/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as unknown;
}

describe("canonicalJson", () => {
  it("hashes semantically identical objects identically", () => {
    const left = fixture("left.json");
    const right = fixture("right.json");

    expect(sha256(canonicalJson(left))).toBe(sha256(canonicalJson(right)));
  });

  it("sorts keys recursively, preserves arrays and Unicode, and emits one LF", () => {
    const result = canonicalJson({ z: [3, 2, 1], nested: { b: true, a: "é" } });

    expect(result).toBe('{"nested":{"a":"é","b":true},"z":[3,2,1]}\n');
    expect(result.endsWith("\n")).toBe(true);
    expect(result.endsWith("\n\n")).toBe(false);
    expect(result).not.toContain("\r");
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    Symbol("value"),
    () => undefined,
    new Date("2026-07-14T12:00:00.000Z"),
    new Map(),
  ])("rejects unsupported value %s", (value) => {
    expect(() => canonicalJson({ value })).toThrow(/canonical JSON/i);
  });

  it("rejects sparse arrays and cycles", () => {
    const sparse = new Array<unknown>(1);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalJson(sparse)).toThrow(/canonical JSON/i);
    expect(() => canonicalJson(cyclic)).toThrow(/canonical JSON/i);
  });

  it("hashes explicit UTF-8 strings and bytes identically", () => {
    const value = canonicalJson({ greeting: "નમસ્તે" });

    expect(sha256(value)).toBe(sha256(Buffer.from(value, "utf8")));
    expect(sha256(value)).toMatch(/^[a-f0-9]{64}$/);
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  stringify,
} from "yaml";

import {
  failure,
  success,
  type RuntimeResult,
} from "../contracts/runtime-result.js";
import { resolveInside } from "./path-safety.js";

class JsonDocumentError extends Error {
  constructor(
    readonly code: "JSON_DUPLICATE_KEY" | "JSON_PARSE_FAILED",
    readonly documentPath: string,
    message: string,
  ) {
    super(message);
  }
}

function jsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

class StrictJsonParser {
  #index = 0;

  constructor(
    private readonly text: string,
    private readonly source: string,
  ) {}

  parse(): unknown {
    this.#skipWhitespace();
    const value = this.#parseValue("");
    this.#skipWhitespace();
    if (this.#index !== this.text.length) {
      this.#fail("unexpected trailing content");
    }
    return value;
  }

  #parseValue(pointer: string): unknown {
    const character = this.text[this.#index];
    if (character === "{") return this.#parseObject(pointer);
    if (character === "[") return this.#parseArray(pointer);
    if (character === '"') return this.#parseString();
    if (character === "t") return this.#parseLiteral("true", true);
    if (character === "f") return this.#parseLiteral("false", false);
    if (character === "n") return this.#parseLiteral("null", null);
    if (character === "-" || (character !== undefined && /[0-9]/.test(character))) {
      return this.#parseNumber();
    }
    return this.#fail("expected a JSON value");
  }

  #parseObject(pointer: string): Record<string, unknown> {
    this.#index += 1;
    this.#skipWhitespace();
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.text[this.#index] === "}") {
      this.#index += 1;
      return result;
    }
    for (;;) {
      if (this.text[this.#index] !== '"') this.#fail("expected an object key");
      const key = this.#parseString();
      if (keys.has(key)) {
        throw new JsonDocumentError(
          "JSON_DUPLICATE_KEY",
          this.source,
          `duplicate JSON key at ${pointer}/${jsonPointerSegment(key)}`,
        );
      }
      keys.add(key);
      this.#skipWhitespace();
      this.#expect(":");
      this.#skipWhitespace();
      const value = this.#parseValue(`${pointer}/${jsonPointerSegment(key)}`);
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.#skipWhitespace();
      const separator = this.text[this.#index];
      if (separator === "}") {
        this.#index += 1;
        return result;
      }
      this.#expect(",");
      this.#skipWhitespace();
    }
  }

  #parseArray(pointer: string): unknown[] {
    this.#index += 1;
    this.#skipWhitespace();
    const result: unknown[] = [];
    if (this.text[this.#index] === "]") {
      this.#index += 1;
      return result;
    }
    for (;;) {
      result.push(this.#parseValue(`${pointer}/${String(result.length)}`));
      this.#skipWhitespace();
      const separator = this.text[this.#index];
      if (separator === "]") {
        this.#index += 1;
        return result;
      }
      this.#expect(",");
      this.#skipWhitespace();
    }
  }

  #parseString(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.text.length) {
      const character = this.text[this.#index];
      if (character === '"') {
        this.#index += 1;
        const parsed = JSON.parse(this.text.slice(start, this.#index)) as unknown;
        if (typeof parsed !== "string") this.#fail("invalid JSON string");
        return parsed;
      }
      if (character === "\\") {
        this.#index += 1;
        const escape = this.text[this.#index];
        if (escape === "u") {
          const digits = this.text.slice(this.#index + 1, this.#index + 5);
          if (!/^[a-fA-F0-9]{4}$/.test(digits)) this.#fail("invalid Unicode escape");
          this.#index += 5;
          continue;
        }
        if (escape === undefined || !/^["\\/bfnrt]$/.test(escape)) {
          this.#fail("invalid string escape");
        }
        this.#index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        this.#fail("unescaped control character in string");
      }
      this.#index += 1;
    }
    return this.#fail("unterminated JSON string");
  }

  #parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.#index),
    );
    if (match === null) return this.#fail("invalid JSON number");
    this.#index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return this.#fail("JSON number must be finite");
    return value;
  }

  #parseLiteral<T>(literal: string, value: T): T {
    if (!this.text.startsWith(literal, this.#index)) {
      return this.#fail(`expected ${literal}`);
    }
    this.#index += literal.length;
    return value;
  }

  #skipWhitespace(): void {
    while (/^[\t\n\r ]$/.test(this.text[this.#index] ?? "")) this.#index += 1;
  }

  #expect(character: string): void {
    if (this.text[this.#index] !== character) this.#fail(`expected ${character}`);
    this.#index += 1;
  }

  #fail(message: string): never {
    throw new JsonDocumentError(
      "JSON_PARSE_FAILED",
      this.source,
      `${message} at character ${String(this.#index)}`,
    );
  }
}

export function parseJsonDocument(
  text: string,
  source: string,
): RuntimeResult<unknown> {
  try {
    return success(new StrictJsonParser(text, source).parse());
  } catch (error: unknown) {
    if (error instanceof JsonDocumentError) {
      return failure(error.code, error.message, error.documentPath);
    }
    return failure("JSON_PARSE_FAILED", "JSON parsing failed", source);
  }
}

const ALLOWED_YAML_TAGS = new Set([
  "tag:yaml.org,2002:map",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
]);

function yamlNodeIssue(
  code: string,
  source: string,
  message: string,
): RuntimeResult<true> {
  return failure(code, message, source);
}

function validateYamlNode(node: unknown, source: string): RuntimeResult<true> {
  if (node === null || node === undefined) return success(true);
  if (isAlias(node)) {
    return yamlNodeIssue("YAML_ALIAS_FORBIDDEN", source, "YAML aliases are forbidden");
  }
  if (isMap(node)) {
    if (node.tag !== undefined && !ALLOWED_YAML_TAGS.has(node.tag)) {
      return yamlNodeIssue("YAML_TAG_FORBIDDEN", source, `forbidden YAML tag: ${node.tag}`);
    }
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        return yamlNodeIssue(
          "YAML_NON_STRING_KEY",
          source,
          "YAML mapping keys must be strings",
        );
      }
      const keyResult = validateYamlNode(pair.key, source);
      if (!keyResult.ok) return keyResult;
      const valueResult = validateYamlNode(pair.value, source);
      if (!valueResult.ok) return valueResult;
    }
    return success(true);
  }
  if (isSeq(node)) {
    if (node.tag !== undefined && !ALLOWED_YAML_TAGS.has(node.tag)) {
      return yamlNodeIssue("YAML_TAG_FORBIDDEN", source, `forbidden YAML tag: ${node.tag}`);
    }
    for (const item of node.items) {
      const result = validateYamlNode(item, source);
      if (!result.ok) return result;
    }
    return success(true);
  }
  if (isScalar(node)) {
    if (node.tag !== undefined && !ALLOWED_YAML_TAGS.has(node.tag)) {
      return yamlNodeIssue("YAML_TAG_FORBIDDEN", source, `forbidden YAML tag: ${node.tag}`);
    }
    const value = node.value;
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      return yamlNodeIssue(
        "YAML_NON_JSON_VALUE",
        source,
        "YAML scalar is not a JSON-compatible finite value",
      );
    }
    return success(true);
  }
  return yamlNodeIssue("YAML_NON_JSON_VALUE", source, "unknown YAML node type");
}

function validateJsonValueRecursive(
  value: unknown,
  source: string,
  ancestors: WeakSet<object>,
): RuntimeResult<unknown> {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return success(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? success(value)
      : failure("YAML_NON_JSON_VALUE", "number must be finite", source);
  }
  if (typeof value !== "object") {
    return failure("YAML_NON_JSON_VALUE", `unsupported ${typeof value} value`, source);
  }
  if (ancestors.has(value)) {
    return failure("YAML_NON_JSON_VALUE", "cyclic value is forbidden", source);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return failure("YAML_NON_JSON_VALUE", "sparse arrays are forbidden", source);
        }
        const result = validateJsonValueRecursive(value[index], source, ancestors);
        if (!result.ok) return result;
      }
      return success(value);
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return failure("YAML_NON_JSON_VALUE", "custom object types are forbidden", source);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return failure("YAML_NON_JSON_VALUE", "symbol keys are forbidden", source);
    }
    for (const entry of Object.values(value)) {
      const result = validateJsonValueRecursive(entry, source, ancestors);
      if (!result.ok) return result;
    }
    return success(value);
  } finally {
    ancestors.delete(value);
  }
}

export function validateJsonValue(
  value: unknown,
  source: string,
): RuntimeResult<unknown> {
  return validateJsonValueRecursive(value, source, new WeakSet());
}

function yamlFailure(source: string, errors: readonly unknown[]): RuntimeResult<unknown> {
  const message = errors
    .map((error) => (error instanceof Error ? error.message : String(error)))
    .join("; ");
  return failure("YAML_PARSE_FAILED", message || "YAML parsing failed", source);
}

export function parseYamlDocument(
  text: string,
  source: string,
): RuntimeResult<unknown> {
  try {
    const documents = parseAllDocuments(text, {
      schema: "core",
      version: "1.2",
      merge: false,
      customTags: [],
      resolveKnownTags: false,
      uniqueKeys: true,
      prettyErrors: false,
    });
    if (documents.length !== 1) {
      return failure(
        "YAML_DOCUMENT_COUNT",
        `expected one YAML document, found ${String(documents.length)}`,
        source,
      );
    }
    const document = documents[0];
    if (document === undefined || document.errors.length > 0) {
      return yamlFailure(source, document?.errors ?? []);
    }
    const safeNodes = validateYamlNode(document.contents, source);
    if (!safeNodes.ok) return safeNodes;
    if (document.warnings.length > 0) return yamlFailure(source, document.warnings);
    const value = document.toJS({ maxAliasCount: 0, mapAsMap: false }) as unknown;
    return validateJsonValue(value, source);
  } catch (error: unknown) {
    return yamlFailure(source, [error]);
  }
}

export function decodeStrictUtf8(
  bytes: Uint8Array,
  source = "document",
): RuntimeResult<string> {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return failure("UTF8_BOM_FORBIDDEN", "UTF-8 BOM is forbidden", source);
  }
  try {
    return success(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return failure("UTF8_INVALID", "document is not valid UTF-8", source);
  }
}

export function normalizeGitTextBytes(bytes: Uint8Array): Uint8Array {
  let crlfCount = 0;
  for (let index = 0; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a) crlfCount += 1;
  }
  if (crlfCount === 0) return bytes;
  const normalized = new Uint8Array(bytes.length - crlfCount);
  let target = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a) continue;
    normalized[target] = bytes[index] ?? 0;
    target += 1;
  }
  return normalized;
}

export async function readUtf8Document(
  root: URL,
  relativePath: string,
): Promise<RuntimeResult<unknown>> {
  const resolved = await resolveInside(root, relativePath);
  if (!resolved.ok) return resolved;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(resolved.value));
  } catch {
    return failure("DOCUMENT_READ_FAILED", "could not read document", relativePath);
  }
  const decoded = decodeStrictUtf8(bytes, relativePath);
  if (!decoded.ok) return decoded;
  const text = decoded.value;
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    return parseYamlDocument(text, relativePath);
  }
  if (extension === ".json") return parseJsonDocument(text, relativePath);
  return failure(
    "DOCUMENT_EXTENSION_UNSUPPORTED",
    "document extension must be .yaml, .yml, or .json",
    relativePath,
  );
}

export function emitGeneratedYaml(value: unknown): RuntimeResult<string> {
  const valid = validateJsonValue(value, "generated-yaml");
  if (!valid.ok) return valid;
  try {
    const emitted = stringify(value, {
      version: "1.2",
      schema: "core",
      merge: false,
      aliasDuplicateObjects: false,
      sortMapEntries: true,
      lineWidth: 0,
      defaultKeyType: "PLAIN",
      defaultStringType: "QUOTE_DOUBLE",
      doubleQuotedAsJSON: true,
    });
    return success(`${emitted.replaceAll("\r\n", "\n").trimEnd()}\n`);
  } catch {
    return failure("YAML_EMIT_FAILED", "could not emit generated YAML");
  }
}

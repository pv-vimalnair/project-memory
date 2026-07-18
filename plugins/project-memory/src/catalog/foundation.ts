import { registerSchema } from "../schema/registry.js";
import { validateWithSchema } from "../schema/validate.js";
import { canonicalJson } from "../core/canonical-json.js";
import {
  parseJsonDocument,
  parseYamlDocument,
  readUtf8Document,
} from "../core/document-io.js";
import { sha256 } from "../core/hash.js";
import { resolveInside } from "../core/path-safety.js";

export const catalogFoundation = Object.freeze({
  canonicalJson,
  parseJsonDocument,
  parseYamlDocument,
  readUtf8Document,
  registerSchema,
  resolveInside,
  sha256,
  validateWithSchema,
});

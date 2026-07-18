type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function invalid(path: string, reason: string): never {
  throw new TypeError(`canonical JSON rejected ${path}: ${reason}`);
}

function normalize(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return invalid(path, "numbers must be finite");
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value !== "object") {
    return invalid(path, `unsupported ${typeof value} value`);
  }

  if (ancestors.has(value)) {
    return invalid(path, "cyclic value");
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const normalized: CanonicalValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return invalid(`${path}[${String(index)}]`, "sparse array element");
        }
        normalized.push(
          normalize(value[index], `${path}[${String(index)}]`, ancestors),
        );
      }
      return normalized;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid(path, "objects must use a plain or null prototype");
    }

    const symbolKeys = Object.getOwnPropertySymbols(value);
    if (symbolKeys.length > 0) {
      return invalid(path, "symbol keys are unsupported");
    }

    const normalized: Record<string, CanonicalValue> = {};
    const keys = Object.keys(value).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return invalid(`${path}.${key}`, "accessor properties are unsupported");
      }
      normalized[key] = normalize(descriptor.value, `${path}.${key}`, ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(normalize(value, "$", new WeakSet()))}\n`;
}

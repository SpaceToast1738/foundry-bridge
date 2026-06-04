export type Doc = Record<string, unknown>;

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

export function filterDocumentFields(
  doc: Doc,
  requestedFields: readonly string[] | null | undefined,
): Doc {
  if (!requestedFields || requestedFields.length === 0) {
    return doc;
  }

  const fieldsToInclude = new Set<string>(requestedFields);
  fieldsToInclude.add("_id");
  fieldsToInclude.add("name");

  const filtered: Doc = {};
  for (const field of fieldsToInclude) {
    if (field in doc) {
      filtered[field] = doc[field];
    }
  }
  return filtered;
}

export function filterDocumentsByWhere(
  docs: readonly Doc[],
  where: Doc | null | undefined,
): Doc[] {
  if (!where || Object.keys(where).length === 0) {
    return [...docs];
  }

  return docs.filter((doc) => {
    for (const [key, value] of Object.entries(where)) {
      if (doc[key] !== value) {
        return false;
      }
    }
    return true;
  });
}

function valueAtPath(doc: Doc, path: string): unknown {
  if (path in doc) return doc[path];
  let current: unknown = doc;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function compareValues(a: unknown, b: unknown): number {
  // undefined / null sort last regardless of direction.
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Stable sort by a (possibly dotted) field path. `undefined`/`null` always sort
 * to the end. Returns a new array; the input is not mutated.
 */
export function sortDocuments(
  docs: readonly Doc[],
  field: string | null | undefined,
  dir: "asc" | "desc" | null | undefined,
): Doc[] {
  if (!field) return [...docs];
  const factor = dir === "desc" ? -1 : 1;
  return docs
    .map((doc, index) => ({ doc, index }))
    .sort((x, y) => {
      const missingX = valueAtPath(x.doc, field);
      const missingY = valueAtPath(y.doc, field);
      // Keep undefined/null last in BOTH directions (don't flip by factor).
      const xMissing = missingX === undefined || missingX === null;
      const yMissing = missingY === undefined || missingY === null;
      if (xMissing || yMissing) {
        const c = compareValues(missingX, missingY);
        return c !== 0 ? c : x.index - y.index;
      }
      const c = compareValues(missingX, missingY) * factor;
      return c !== 0 ? c : x.index - y.index;
    })
    .map((entry) => entry.doc);
}

export function truncateDocuments(docs: readonly Doc[], maxLength: number | null | undefined): Doc[] {
  if (!maxLength || maxLength <= 0) {
    return [...docs];
  }

  const result = [...docs];
  while (result.length > 0) {
    if (byteLength(JSON.stringify(result)) <= maxLength) {
      return result;
    }
    result.pop();
  }
  return result;
}

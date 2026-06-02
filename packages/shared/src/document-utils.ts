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

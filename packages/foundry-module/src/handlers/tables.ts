import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  docToObject,
  findInCollection,
  getCollection,
  getDocumentClass,
} from "../collections.js";

interface TableDoc {
  id?: string;
  name?: string;
  results?: { contents?: unknown[] };
  createEmbeddedDocuments(name: string, data: Record<string, unknown>[]): Promise<unknown[]>;
  normalize?: () => Promise<unknown>;
}

type ResultInput = string | { text: string; weight?: number };

function toResultDocs(results: ResultInput[]): Record<string, unknown>[] {
  return results.map((r) => {
    const text = typeof r === "string" ? r : r.text;
    const weight = typeof r === "string" ? 1 : r.weight ?? 1;
    // Foundry v13+ requires a valid `range` at creation (a no-range result is
    // silently rejected); normalize() recomputes ranges + the 1dN formula from
    // weights afterwards. `name` is the displayed label; `text` populates the
    // description for older readers.
    return { type: "text", name: text, text, weight, range: [1, 1] };
  });
}

async function addResults(table: TableDoc, results: ResultInput[]): Promise<void> {
  await table.createEmbeddedDocuments("TableResult", toResultDocs(results));
  if (typeof table.normalize === "function") await table.normalize();
}

export async function handleTableCreate(
  params: ParamsFor<typeof Method.TABLE_CREATE>,
): Promise<Record<string, unknown>> {
  const cls = getDocumentClass("RollTable");
  if (!cls) {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "RollTable document class is not loaded");
  }
  const data: Record<string, unknown> = { name: params.name };
  if (params.folder !== undefined) data.folder = params.folder;
  if (params.formula !== undefined) data.formula = params.formula;
  const created = await cls.createDocuments([data]);
  const table = created[0] as TableDoc | undefined;
  if (!table) {
    throw new BridgeError(ErrorCode.INTERNAL, "RollTable creation returned nothing");
  }
  if (params.results && params.results.length > 0 && typeof table.createEmbeddedDocuments === "function") {
    await addResults(table, params.results);
  }
  return docToObject(table);
}

export async function handleTableAddResults(
  params: ParamsFor<typeof Method.TABLE_ADD_RESULTS>,
): Promise<Record<string, unknown>> {
  const tables = getCollection("tables");
  const raw = tables && findInCollection(tables, params.table);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Roll table not found by ref ${JSON.stringify(params.table)}`,
    );
  }
  const table = raw as TableDoc;
  await addResults(table, params.results);
  return {
    table: table.id,
    added: params.results.length,
    total: table.results?.contents?.length,
  };
}

import {
  BridgeError,
  ErrorCode,
  filterDocumentFields,
  filterDocumentsByWhere,
  truncateDocuments,
  type ParamsFor,
  Method,
} from "@foundry-bridge/shared";
import {
  docToObject,
  getCollection,
  isReadableCollection,
} from "../collections.js";

export function handleDocumentsList(
  params: ParamsFor<typeof Method.DOCUMENTS_LIST>,
): { collection: string; count: number; documents: Record<string, unknown>[] } {
  if (!isReadableCollection(params.collection)) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Unknown collection '${params.collection}'`,
    );
  }
  const collection = getCollection(params.collection);
  if (!collection) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `Collection '${params.collection}' is not loaded`,
    );
  }
  let docs = collection.contents.map(docToObject);
  docs = filterDocumentsByWhere(docs, params.where);
  docs = docs.map((d) => filterDocumentFields(d, params.requested_fields));
  docs = truncateDocuments(docs, params.max_length);
  return {
    collection: params.collection,
    count: docs.length,
    documents: docs,
  };
}

export function handleDocumentsGet(
  params: ParamsFor<typeof Method.DOCUMENTS_GET>,
): Record<string, unknown> {
  if (!isReadableCollection(params.collection)) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Unknown collection '${params.collection}'`,
    );
  }
  const collection = getCollection(params.collection);
  if (!collection) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `Collection '${params.collection}' is not loaded`,
    );
  }

  const idRef = params.ref._id ?? params.ref.id;
  let raw: unknown;
  if (idRef) {
    raw = collection.get(idRef);
  }
  if (!raw && params.ref.name) {
    raw = collection.contents.find((d) => {
      const obj = d as Record<string, unknown> | null;
      return obj && typeof obj === "object" && obj.name === params.ref.name;
    });
  }

  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `No ${params.collection} matched ref ${JSON.stringify(params.ref)}`,
    );
  }

  const doc = docToObject(raw);
  return filterDocumentFields(doc, params.requested_fields);
}

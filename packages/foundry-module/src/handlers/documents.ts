import {
  BridgeError,
  ErrorCode,
  filterDocumentFields,
  filterDocumentsByWhere,
  sortDocuments,
  truncateDocuments,
  type ParamsFor,
  Method,
} from "@foundry-bridge/shared";
import {
  collectionForType,
  docToObject,
  findInCollection,
  getCollection,
  getDocumentClass,
  isReadableCollection,
  isWritableDocumentType,
} from "../collections.js";
import { assertBulkLimit, type PermissionState } from "../permissions.js";

export function handleDocumentsList(
  params: ParamsFor<typeof Method.DOCUMENTS_LIST>,
): {
  collection: string;
  count: number;
  total: number;
  offset: number;
  limit: number | null;
  truncated: boolean;
  documents: Record<string, unknown>[];
} {
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
  // where -> sort -> count total -> offset/limit -> field projection -> max_length.
  let docs = collection.contents.map(docToObject);
  docs = filterDocumentsByWhere(docs, params.where);
  docs = sortDocuments(docs, params.sort, params.sort_dir);
  const total = docs.length;

  const offset = params.offset ?? 0;
  const limit = params.limit ?? null;
  if (offset > 0 || limit !== null) {
    docs = docs.slice(offset, limit === null ? undefined : offset + limit);
  }

  docs = docs.map((d) => filterDocumentFields(d, params.requested_fields));
  const afterPaging = docs.length;
  docs = truncateDocuments(docs, params.max_length);
  const truncated = docs.length < afterPaging;

  return {
    collection: params.collection,
    count: docs.length,
    total,
    offset,
    limit,
    truncated,
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

  const raw = findInCollection(collection, params.ref);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `No ${params.collection} matched ref ${JSON.stringify(params.ref)}`,
    );
  }
  const doc = docToObject(raw);
  return filterDocumentFields(doc, params.requested_fields);
}

function resolveDocClass(type: string) {
  if (!isWritableDocumentType(type)) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Unknown document type '${type}'`,
    );
  }
  const cls = getDocumentClass(type);
  if (!cls) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `Document class '${type}' is not loaded`,
    );
  }
  return { cls, type };
}

export async function handleDocumentsCreate(
  params: ParamsFor<typeof Method.DOCUMENTS_CREATE>,
): Promise<{ type: string; count: number; documents: Record<string, unknown>[] }> {
  const { cls, type } = resolveDocClass(params.type);
  const created = await cls.createDocuments(params.data);
  return {
    type,
    count: created.length,
    documents: created.map(docToObject),
  };
}

export async function handleDocumentsUpdate(
  params: ParamsFor<typeof Method.DOCUMENTS_UPDATE>,
): Promise<Record<string, unknown>> {
  const { cls, type } = resolveDocClass(params.type);
  const collection = getCollection(collectionForType(type));
  if (!collection || collection.get(params._id) === undefined) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `${type} ${params._id} not found`,
    );
  }
  for (const update of params.updates) {
    await cls.updateDocuments([{ ...update, _id: params._id }]);
  }
  const finalDoc = collection.get(params._id);
  return docToObject(finalDoc);
}

interface CloneableDoc {
  name?: string;
  clone(data: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown>;
}

export async function handleDocumentsDuplicate(
  params: ParamsFor<typeof Method.DOCUMENTS_DUPLICATE>,
): Promise<Record<string, unknown>> {
  if (!isWritableDocumentType(params.type)) {
    throw new BridgeError(ErrorCode.BAD_REQUEST, `Unknown document type '${params.type}'`);
  }
  const collection = getCollection(collectionForType(params.type));
  const raw = collection && findInCollection(collection, params.ref);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `${params.type} not found by ref ${JSON.stringify(params.ref)}`,
    );
  }
  const doc = raw as CloneableDoc;
  if (typeof doc.clone !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, `${params.type} does not support clone()`);
  }
  const updates: Record<string, unknown> = {
    name: params.name ?? `${doc.name ?? params.type} (Copy)`,
  };
  if (params.folder !== undefined) updates.folder = params.folder;
  const copy = await doc.clone(updates, { save: true });
  return docToObject(Array.isArray(copy) ? copy[0] : copy);
}

export async function handleDocumentsDelete(
  params: ParamsFor<typeof Method.DOCUMENTS_DELETE>,
  state: PermissionState,
): Promise<{ type: string; count: number; ids: string[] }> {
  const { cls, type } = resolveDocClass(params.type);
  assertBulkLimit(Method.DOCUMENTS_DELETE, params.ids.length, state);
  const deleted = await cls.deleteDocuments(params.ids);
  const ids = deleted
    .map((d) => {
      const obj = docToObject(d);
      return typeof obj._id === "string" ? obj._id : null;
    })
    .filter((v): v is string => v !== null);
  return { type, count: ids.length, ids };
}

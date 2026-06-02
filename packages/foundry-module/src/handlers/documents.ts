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

import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  collectionForType,
  docToObject,
  getCollection,
  isWritableDocumentType,
} from "../collections.js";
import { assertBulkLimit, type PermissionState } from "../permissions.js";

interface EmbeddedParent {
  createEmbeddedDocuments(
    embeddedName: string,
    data: Record<string, unknown>[],
    context?: Record<string, unknown>,
  ): Promise<unknown[]>;
  updateEmbeddedDocuments(
    embeddedName: string,
    updates: Record<string, unknown>[],
    context?: Record<string, unknown>,
  ): Promise<unknown[]>;
  deleteEmbeddedDocuments(
    embeddedName: string,
    ids: string[],
    context?: Record<string, unknown>,
  ): Promise<unknown[]>;
}

/** Resolve the parent document and assert it supports embedded operations. */
function resolveParent(parentType: string, parentId: string): EmbeddedParent {
  if (!isWritableDocumentType(parentType)) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Unknown parent document type '${parentType}'`,
    );
  }
  const collection = getCollection(collectionForType(parentType));
  const parent = collection?.get(parentId);
  if (!parent) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `${parentType} ${parentId} not found`,
    );
  }
  const p = parent as Partial<EmbeddedParent>;
  if (
    typeof p.createEmbeddedDocuments !== "function" ||
    typeof p.updateEmbeddedDocuments !== "function" ||
    typeof p.deleteEmbeddedDocuments !== "function"
  ) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `${parentType} does not support embedded documents`,
    );
  }
  return parent as EmbeddedParent;
}

export async function handleEmbeddedCreate(
  params: ParamsFor<typeof Method.EMBEDDED_CREATE>,
): Promise<{ parent_id: string; embedded: string; count: number; documents: Record<string, unknown>[] }> {
  const parent = resolveParent(params.parent_type, params.parent_id);
  const created = await parent.createEmbeddedDocuments(params.embedded, params.data);
  return {
    parent_id: params.parent_id,
    embedded: params.embedded,
    count: created.length,
    documents: created.map(docToObject),
  };
}

export async function handleEmbeddedUpdate(
  params: ParamsFor<typeof Method.EMBEDDED_UPDATE>,
): Promise<{ parent_id: string; embedded: string; count: number; documents: Record<string, unknown>[] }> {
  const parent = resolveParent(params.parent_type, params.parent_id);
  const updated = await parent.updateEmbeddedDocuments(params.embedded, params.updates);
  return {
    parent_id: params.parent_id,
    embedded: params.embedded,
    count: updated.length,
    documents: updated.map(docToObject),
  };
}

export async function handleEmbeddedDelete(
  params: ParamsFor<typeof Method.EMBEDDED_DELETE>,
  state: PermissionState,
): Promise<{ parent_id: string; embedded: string; count: number; ids: string[] }> {
  assertBulkLimit(Method.EMBEDDED_DELETE, params.ids.length, state);
  const parent = resolveParent(params.parent_type, params.parent_id);
  const deleted = await parent.deleteEmbeddedDocuments(params.embedded, params.ids);
  const ids = deleted
    .map((d) => {
      const obj = docToObject(d);
      return typeof obj._id === "string" ? obj._id : null;
    })
    .filter((v): v is string => v !== null);
  return {
    parent_id: params.parent_id,
    embedded: params.embedded,
    count: ids.length,
    ids,
  };
}

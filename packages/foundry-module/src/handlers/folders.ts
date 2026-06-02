import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  collectionForType,
  docToObject,
  findInCollection,
  getCollection,
  getDocumentClass,
  isFolderDocumentType,
  isWritableDocumentType,
} from "../collections.js";

export async function handleFoldersCreate(
  params: ParamsFor<typeof Method.FOLDERS_CREATE>,
): Promise<Record<string, unknown>> {
  if (!isFolderDocumentType(params.type)) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Cannot create folders of type '${params.type}'`,
    );
  }
  const folderClass = getDocumentClass("Folder");
  if (!folderClass) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "Folder document class is not loaded",
    );
  }
  if (params.parent !== undefined) {
    const folders = getCollection("folders");
    if (!folders || folders.get(params.parent) === undefined) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `Parent folder '${params.parent}' not found`,
      );
    }
  }
  const created = await folderClass.createDocuments([
    {
      name: params.name,
      type: params.type,
      folder: params.parent ?? null,
    },
  ]);
  if (created.length === 0) {
    throw new BridgeError(
      ErrorCode.INTERNAL,
      "Folder.createDocuments returned no document",
    );
  }
  return docToObject(created[0]);
}

const MOVABLE_TYPES = new Set<string>([
  "Actor",
  "Item",
  "JournalEntry",
  "Scene",
  "Folder",
]);

export async function handleFoldersMove(
  params: ParamsFor<typeof Method.FOLDERS_MOVE>,
): Promise<Record<string, unknown>> {
  if (!isWritableDocumentType(params.type) || !MOVABLE_TYPES.has(params.type)) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Type '${params.type}' cannot be foldered`,
    );
  }
  const cls = getDocumentClass(params.type);
  if (!cls) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `Document class '${params.type}' is not loaded`,
    );
  }
  const entityCollection = getCollection(
    params.type === "Folder" ? "folders" : collectionForType(params.type),
  );
  if (!entityCollection) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `Collection for '${params.type}' is not loaded`,
    );
  }
  const entityRaw = findInCollection(entityCollection, params.entity);
  if (!entityRaw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `${params.type} not found by ref ${JSON.stringify(params.entity)}`,
    );
  }
  const entityObj = docToObject(entityRaw);
  const entityId = entityObj._id;
  if (typeof entityId !== "string") {
    throw new BridgeError(
      ErrorCode.INTERNAL,
      `${params.type} missing _id after lookup`,
    );
  }

  let folderId: string | null = null;
  if (params.folder !== null) {
    const folders = getCollection("folders");
    if (!folders) {
      throw new BridgeError(
        ErrorCode.UNAVAILABLE,
        "Folder collection is not loaded",
      );
    }
    const folderRaw = findInCollection(folders, params.folder);
    if (!folderRaw) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `Folder not found by ref ${JSON.stringify(params.folder)}`,
      );
    }
    const folderObj = docToObject(folderRaw);
    if (typeof folderObj._id !== "string") {
      throw new BridgeError(
        ErrorCode.INTERNAL,
        "Target folder missing _id after lookup",
      );
    }
    folderId = folderObj._id;
  }

  await cls.updateDocuments([{ _id: entityId, folder: folderId }]);
  const updated = entityCollection.get(entityId);
  return docToObject(updated);
}

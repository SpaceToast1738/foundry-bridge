export interface FoundryCollection<T = unknown> {
  contents: T[];
  get(id: string): T | undefined;
}

export const READABLE_COLLECTIONS = [
  "actors",
  "items",
  "journal",
  "folders",
  "scenes",
  "users",
] as const;

export type ReadableCollection = (typeof READABLE_COLLECTIONS)[number];

export function isReadableCollection(name: string): name is ReadableCollection {
  return (READABLE_COLLECTIONS as readonly string[]).includes(name);
}

export const WRITABLE_DOCUMENT_TYPES = [
  "Actor",
  "Item",
  "JournalEntry",
  "Folder",
  "Scene",
  "User",
] as const;

export type WritableDocumentType = (typeof WRITABLE_DOCUMENT_TYPES)[number];

export function isWritableDocumentType(
  name: string,
): name is WritableDocumentType {
  return (WRITABLE_DOCUMENT_TYPES as readonly string[]).includes(name);
}

const DOC_TYPE_TO_COLLECTION: Record<WritableDocumentType, ReadableCollection> = {
  Actor: "actors",
  Item: "items",
  JournalEntry: "journal",
  Folder: "folders",
  Scene: "scenes",
  User: "users",
};

export function collectionForType(
  type: WritableDocumentType,
): ReadableCollection {
  return DOC_TYPE_TO_COLLECTION[type];
}

export interface FoundryDocumentClass {
  createDocuments(
    data: Record<string, unknown>[],
    context?: Record<string, unknown>,
  ): Promise<unknown[]>;
  updateDocuments(
    updates: Record<string, unknown>[],
    context?: Record<string, unknown>,
  ): Promise<unknown[]>;
  deleteDocuments(
    ids: string[],
    context?: Record<string, unknown>,
  ): Promise<unknown[]>;
}

export function getDocumentClass(
  type: string,
): FoundryDocumentClass | undefined {
  if (!isWritableDocumentType(type)) return undefined;
  const cls = (globalThis as Record<string, unknown>)[type];
  if (
    cls &&
    typeof (cls as FoundryDocumentClass).createDocuments === "function" &&
    typeof (cls as FoundryDocumentClass).updateDocuments === "function" &&
    typeof (cls as FoundryDocumentClass).deleteDocuments === "function"
  ) {
    return cls as FoundryDocumentClass;
  }
  return undefined;
}

export function getCollection(name: string): FoundryCollection | undefined {
  switch (name) {
    case "actors":
      return game.actors as FoundryCollection | undefined;
    case "items":
      return game.items as FoundryCollection | undefined;
    case "journal":
      return game.journal as FoundryCollection | undefined;
    case "folders":
      return game.folders as FoundryCollection | undefined;
    case "scenes":
      return game.scenes as FoundryCollection | undefined;
    case "users":
      return game.users as FoundryCollection | undefined;
    default:
      return undefined;
  }
}

interface MaybeSerializable {
  toObject?: () => Record<string, unknown>;
  toJSON?: () => Record<string, unknown>;
}

export function docToObject(doc: unknown): Record<string, unknown> {
  if (doc && typeof doc === "object") {
    const maybe = doc as MaybeSerializable;
    if (typeof maybe.toObject === "function") return maybe.toObject();
    if (typeof maybe.toJSON === "function") return maybe.toJSON();
    return { ...(doc as Record<string, unknown>) };
  }
  return {};
}

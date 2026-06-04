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
  isWritableDocumentType,
} from "../collections.js";

interface PackMetadata {
  id?: string;
  label?: string;
  type?: string;
  packageType?: string;
  packageName?: string;
  system?: string;
}

interface FoundryPack {
  metadata: PackMetadata;
  documentName: string;
  locked?: boolean;
  getIndex(): Promise<{ contents: Record<string, unknown>[] }>;
  getDocument(id: string): Promise<unknown>;
  deleteCompendium?: () => Promise<unknown>;
}

interface CompendiumCollectionClass {
  createCompendium(
    metadata: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ metadata?: PackMetadata }>;
}

function getCompendiumClass(): CompendiumCollectionClass {
  const cls = (globalThis as Record<string, unknown>).CompendiumCollection as
    | CompendiumCollectionClass
    | undefined;
  if (!cls || typeof cls.createCompendium !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "CompendiumCollection.createCompendium is not available in this Foundry version",
    );
  }
  return cls;
}

function allPacks(): FoundryPack[] {
  const packs = game.packs as { contents?: unknown[] } | undefined;
  return (packs?.contents ?? []) as FoundryPack[];
}

function getPack(packId: string): FoundryPack {
  const packs = game.packs as { get(id: string): unknown } | undefined;
  const pack = packs?.get(packId) as FoundryPack | undefined;
  if (!pack) {
    throw new BridgeError(ErrorCode.NOT_FOUND, `Compendium pack '${packId}' not found`);
  }
  return pack;
}

export function handleCompendiumList(
  params: ParamsFor<typeof Method.COMPENDIUM_LIST>,
): { count: number; packs: Record<string, unknown>[] } {
  const typeFilter = params?.type;
  const packs = allPacks()
    .map((p) => ({
      id: p.metadata?.id,
      label: p.metadata?.label,
      type: p.metadata?.type ?? p.documentName,
      system: p.metadata?.system,
      packageType: p.metadata?.packageType,
    }))
    .filter((p) => !typeFilter || p.type === typeFilter);
  return { count: packs.length, packs };
}

export async function handleCompendiumSearch(
  params: ParamsFor<typeof Method.COMPENDIUM_SEARCH>,
): Promise<{ pack: string; count: number; entries: Record<string, unknown>[] }> {
  const pack = getPack(params.pack);
  const index = await pack.getIndex();
  const needle = params.query?.toLowerCase();
  const limit = params.limit ?? 50;
  const entries: Record<string, unknown>[] = [];
  for (const raw of index.contents) {
    if (entries.length >= limit) break;
    const name = typeof raw.name === "string" ? raw.name : "";
    if (needle && !name.toLowerCase().includes(needle)) continue;
    if (params.type && raw.type !== params.type) continue;
    entries.push({
      _id: raw._id,
      name: raw.name,
      type: raw.type,
      uuid: raw.uuid,
      img: raw.img,
    });
  }
  return { pack: params.pack, count: entries.length, entries };
}

export async function handleCompendiumImport(
  params: ParamsFor<typeof Method.COMPENDIUM_IMPORT>,
): Promise<{ pack: string; count: number; documents: Record<string, unknown>[] }> {
  const pack = getPack(params.pack);
  const type = pack.documentName;
  if (!isWritableDocumentType(type)) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Pack '${params.pack}' holds '${type}', which cannot be imported`,
    );
  }
  const cls = getDocumentClass(type);
  if (!cls) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `Document class '${type}' is not loaded`,
    );
  }

  // Resolve an optional destination folder _id.
  let folderId: string | null = null;
  if (params.folder !== undefined) {
    if (typeof params.folder === "string") {
      folderId = params.folder;
    } else {
      const folders = getCollection("folders");
      const folderRaw = folders && findInCollection(folders, params.folder);
      if (!folderRaw) {
        throw new BridgeError(
          ErrorCode.NOT_FOUND,
          `Folder not found by ref ${JSON.stringify(params.folder)}`,
        );
      }
      const id = docToObject(folderRaw)._id;
      folderId = typeof id === "string" ? id : null;
    }
  }

  const index = await pack.getIndex();
  const sources: Record<string, unknown>[] = [];
  for (const ref of params.entries) {
    const wantId = ref._id ?? ref.id;
    const entry = index.contents.find((e) =>
      wantId ? e._id === wantId : e.name === ref.name,
    );
    if (!entry) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `Pack entry not found by ref ${JSON.stringify(ref)}`,
      );
    }
    const doc = await pack.getDocument(entry._id as string);
    const source = docToObject(doc);
    delete source._id;
    if (folderId !== null) source.folder = folderId;
    sources.push(source);
  }

  const created = await cls.createDocuments(sources);
  return {
    pack: params.pack,
    count: created.length,
    documents: created.map(docToObject),
  };
}

export async function handleCompendiumExport(
  params: ParamsFor<typeof Method.COMPENDIUM_EXPORT>,
): Promise<{ pack: string; count: number; documents: Record<string, unknown>[] }> {
  const pack = getPack(params.pack);
  if (pack.locked) {
    throw new BridgeError(
      ErrorCode.FORBIDDEN,
      `Compendium pack '${params.pack}' is locked; unlock it in Foundry before exporting.`,
    );
  }
  if (!isWritableDocumentType(params.type)) {
    throw new BridgeError(ErrorCode.BAD_REQUEST, `Unknown document type '${params.type}'`);
  }
  if (pack.documentName && pack.documentName !== params.type) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Pack '${params.pack}' holds '${pack.documentName}', not '${params.type}'`,
    );
  }
  const cls = getDocumentClass(params.type);
  if (!cls) {
    throw new BridgeError(ErrorCode.UNAVAILABLE, `Document class '${params.type}' is not loaded`);
  }
  const collection = getCollection(collectionForType(params.type));
  const sources: Record<string, unknown>[] = [];
  for (const ref of params.entries) {
    const raw = collection && findInCollection(collection, ref);
    if (!raw) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `World ${params.type} not found by ref ${JSON.stringify(ref)}`,
      );
    }
    const source = docToObject(raw);
    delete source._id;
    delete source.folder; // pack folders differ from world folders
    sources.push(source);
  }
  const created = await cls.createDocuments(sources, { pack: pack.metadata.id });
  return {
    pack: params.pack,
    count: created.length,
    documents: created.map(docToObject),
  };
}

export async function handleCompendiumCreate(
  params: ParamsFor<typeof Method.COMPENDIUM_CREATE>,
): Promise<{ id?: string; label: string; type: string }> {
  if (!isWritableDocumentType(params.type)) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Cannot create a pack of type '${params.type}'`,
    );
  }
  const cls = getCompendiumClass();
  const created = await cls.createCompendium({ type: params.type, label: params.label });
  return {
    id: created.metadata?.id,
    label: created.metadata?.label ?? params.label,
    type: params.type,
  };
}

export async function handleCompendiumDelete(
  params: ParamsFor<typeof Method.COMPENDIUM_DELETE>,
): Promise<{ pack: string; deleted: true }> {
  const pack = getPack(params.pack);
  if (typeof pack.deleteCompendium !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "This Foundry version doesn't expose pack.deleteCompendium()",
    );
  }
  await pack.deleteCompendium();
  return { pack: params.pack, deleted: true };
}

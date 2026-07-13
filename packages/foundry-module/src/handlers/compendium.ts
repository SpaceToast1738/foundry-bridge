import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  type DocRef,
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
  getIndex(options?: { fields?: string[] }): Promise<{ contents: Record<string, unknown>[] }>;
  getDocument(id: string): Promise<unknown>;
  deleteCompendium?: () => Promise<unknown>;
}

/** Read a dotted path from an index entry, tolerating either flat-keyed
 * (`raw["system.details.cr"]`) or nested (`raw.system.details.cr`) shapes —
 * Foundry's docs don't pin down which getIndex({fields}) returns. */
function pick(raw: Record<string, unknown>, dotPath: string): unknown {
  if (dotPath in raw) return raw[dotPath];
  let cur: unknown = raw;
  for (const seg of dotPath.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const CREATURE_FIELDS = [
  "system.details.cr",
  "system.details.type.value",
  "system.traits.size",
];

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

/** Resolve a pack entry (by _id/id, name fallback) to its full document as a
 * plain object. Shared by import and get_compendium_entry. */
async function resolveEntrySource(pack: FoundryPack, ref: DocRef): Promise<Record<string, unknown>> {
  const index = await pack.getIndex();
  const wantId = ref._id ?? ref.id;
  const entry = index.contents.find((e) => (wantId ? e._id === wantId : e.name === ref.name));
  if (!entry) {
    throw new BridgeError(ErrorCode.NOT_FOUND, `Pack entry not found by ref ${JSON.stringify(ref)}`);
  }
  const doc = await pack.getDocument(entry._id as string);
  if (doc === undefined || doc === null) {
    throw new BridgeError(ErrorCode.NOT_FOUND, `Pack entry document missing for ${String(entry._id)}`);
  }
  return docToObject(doc);
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
): Promise<{ pack: string | null; count: number; entries: Record<string, unknown>[] }> {
  const needle = params.query?.toLowerCase();
  const limit = params.limit ?? 50;
  const wantCreature =
    params.cr != null ||
    params.cr_min != null ||
    params.cr_max != null ||
    params.creature_type != null ||
    params.size != null;
  const entries: Record<string, unknown>[] = [];

  const matchesCreature = (raw: Record<string, unknown>): boolean => {
    const crRaw = pick(raw, "system.details.cr");
    const cr = typeof crRaw === "number" ? crRaw : Number(crRaw);
    const hasCr = Number.isFinite(cr);
    if (params.cr != null && (!hasCr || cr !== params.cr)) return false;
    if (params.cr_min != null && (!hasCr || cr < params.cr_min)) return false;
    if (params.cr_max != null && (!hasCr || cr > params.cr_max)) return false;
    if (params.creature_type != null && pick(raw, "system.details.type.value") !== params.creature_type) return false;
    if (params.size != null && pick(raw, "system.traits.size") !== params.size) return false;
    return true;
  };

  const scan = async (pack: FoundryPack): Promise<void> => {
    const index = await pack.getIndex(wantCreature ? { fields: CREATURE_FIELDS } : undefined);
    for (const raw of index.contents) {
      if (entries.length >= limit) return;
      const name = typeof raw.name === "string" ? raw.name : "";
      if (needle && !name.toLowerCase().includes(needle)) continue;
      if (params.type && raw.type !== params.type) continue;
      if (wantCreature && !matchesCreature(raw)) continue;
      const out: Record<string, unknown> = {
        _id: raw._id,
        name: raw.name,
        type: raw.type,
        uuid: raw.uuid,
        img: raw.img,
        pack: pack.metadata?.id,
      };
      if (wantCreature) {
        out.cr = pick(raw, "system.details.cr");
        out.creature_type = pick(raw, "system.details.type.value");
        out.size = pick(raw, "system.traits.size");
      }
      entries.push(out);
    }
  };

  if (params.pack) {
    await scan(getPack(params.pack));
  } else {
    for (const pack of allPacks()) {
      if (entries.length >= limit) break;
      if (params.document_type && pack.documentName !== params.document_type) continue;
      // Creature filters only apply to Actor packs — skip the rest to avoid a
      // wasted enriched-index load.
      if (wantCreature && pack.documentName !== "Actor") continue;
      await scan(pack);
    }
  }
  return { pack: params.pack ?? null, count: entries.length, entries };
}

export async function handleCompendiumGetEntry(
  params: ParamsFor<typeof Method.COMPENDIUM_GET_ENTRY>,
): Promise<{ pack: string | null; entry: Record<string, unknown> }> {
  let entry: Record<string, unknown>;
  let packId: string | null = params.pack ?? null;
  if (params.uuid) {
    const doc = await fromUuid(params.uuid);
    if (doc === undefined || doc === null) {
      throw new BridgeError(ErrorCode.NOT_FOUND, `Nothing resolved for uuid '${params.uuid}'`);
    }
    entry = docToObject(doc);
    // Compendium UUID: Compendium.<package>.<pack>.<Type>.<id> → pack id is
    // "<package>.<pack>".
    const parts = params.uuid.split(".");
    if (parts[0] === "Compendium" && parts.length >= 3) packId = `${parts[1]}.${parts[2]}`;
  } else {
    const pack = getPack(params.pack as string);
    entry = await resolveEntrySource(pack, params.entry as DocRef);
  }
  if (params.compact) entry = compactDoc(entry);
  return { pack: packId, entry };
}

/** Strip long HTML/description text to save tokens, keeping stat fields. Stays
 * system-agnostic: drops string values that are long or whose key looks like a
 * description/biography, one level into `system` and into each item's system. */
function compactDoc(obj: Record<string, unknown>): Record<string, unknown> {
  const LONG = 400;
  const PROSE_KEY = /description|biography|gmnotes/i;
  const compactSystem = (system: unknown): unknown => {
    if (!system || typeof system !== "object") return system;
    const walk = (node: unknown): unknown => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return node;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        // Drop prose-named keys entirely (string or {value,...} wrapper) and any
        // long free-text string, keeping numeric/stat fields.
        if (PROSE_KEY.test(k)) continue;
        if (typeof v === "string" && v.length > LONG) continue;
        out[k] = v && typeof v === "object" && !Array.isArray(v) ? walk(v) : v;
      }
      return out;
    };
    return walk(system);
  };
  const clone: Record<string, unknown> = { ...obj };
  if (clone.system) clone.system = compactSystem(clone.system);
  if (Array.isArray(clone.items)) {
    clone.items = (clone.items as Record<string, unknown>[]).map((it) =>
      it && typeof it === "object" && "system" in it ? { ...it, system: compactSystem(it.system) } : it,
    );
  }
  return clone;
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

  const sources: Record<string, unknown>[] = [];
  for (const ref of params.entries) {
    const source = await resolveEntrySource(pack, ref);
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

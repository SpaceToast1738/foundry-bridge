import {
  handleCompendiumCreate,
  handleCompendiumDelete,
  handleCompendiumExport,
  handleCompendiumGetEntry,
  handleCompendiumImport,
  handleCompendiumList,
  handleCompendiumSearch,
} from "../src/handlers/compendium";
import { installFakeGame } from "./helpers/fake-game";

/** Build a fake compendium pack whose getIndex/getDocument honor the real
 * Foundry contract (index entries carry system.* fields; getDocument returns a
 * toObject()-bearing doc or undefined for unknown ids). */
function makePack(opts: {
  id: string;
  documentName?: string;
  label?: string;
  entries: Record<string, unknown>[];
  full?: Record<string, Record<string, unknown>>;
  locked?: boolean;
}) {
  const index = { contents: opts.entries };
  const documentName = opts.documentName ?? "Actor";
  return {
    metadata: { id: opts.id, label: opts.label ?? opts.id, type: documentName, system: "dnd5e", packageType: "system" },
    documentName,
    locked: opts.locked,
    getIndex: async (_o?: { fields?: string[] }) => index,
    getDocument: async (id: string) => {
      const e = index.contents.find((x) => x._id === id);
      if (!e) return undefined;
      const full = opts.full?.[id] ?? { _id: id, name: e.name, type: e.type, system: e.system ?? {} };
      return { toObject: () => full };
    },
  };
}

const LONG_BIO = "<p>" + "lore ".repeat(120) + "</p>";

function monstersPack() {
  return makePack({
    id: "dnd5e.monsters",
    entries: [
      { _id: "m1", name: "Goblin", type: "npc", uuid: "Compendium.dnd5e.monsters.Actor.m1", img: "g.png", system: { details: { cr: 0.25, type: { value: "humanoid" } }, traits: { size: "sm" } } },
      { _id: "m2", name: "Orc", type: "npc", uuid: "Compendium.dnd5e.monsters.Actor.m2", system: { details: { cr: 1, type: { value: "humanoid" } }, traits: { size: "med" } } },
      { _id: "m3", name: "Adult Red Dragon", type: "npc", uuid: "Compendium.dnd5e.monsters.Actor.m3", system: { details: { cr: 17, type: { value: "dragon" } }, traits: { size: "huge" } } },
    ],
    full: {
      m1: { _id: "m1", name: "Goblin", type: "npc", system: { details: { cr: 0.25, type: { value: "humanoid" }, biography: { value: LONG_BIO } }, attributes: { hp: { value: 7 } } } },
      m2: { _id: "m2", name: "Orc", type: "npc", system: { details: { cr: 1, biography: { value: LONG_BIO } }, attributes: { hp: { value: 15 } } } },
      m3: { _id: "m3", name: "Adult Red Dragon", type: "npc", system: { details: { cr: 17 }, attributes: { hp: { value: 256 } } } },
    },
  });
}

describe("compendium handlers", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFakeGame({
      packs: [monstersPack()],
      folders: [{ _id: "f1", name: "Imported", type: "Actor" }],
    });
  });
  afterEach(() => restore());

  it("lists packs (and filters by type)", () => {
    expect(handleCompendiumList({}).count).toBe(1);
    expect(handleCompendiumList({ type: "Actor" }).packs[0]).toMatchObject({
      id: "dnd5e.monsters",
      type: "Actor",
    });
    expect(handleCompendiumList({ type: "Item" }).count).toBe(0);
  });

  it("searches a pack index by name", async () => {
    const res = await handleCompendiumSearch({ pack: "dnd5e.monsters", query: "gob" });
    expect(res.count).toBe(1);
    expect(res.entries[0]).toMatchObject({ _id: "m1", name: "Goblin", uuid: expect.any(String) });
  });

  it("NOT_FOUND for an unknown pack", async () => {
    await expect(
      handleCompendiumSearch({ pack: "nope.nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("imports an entry into a folder, stripping the source _id", async () => {
    const res = await handleCompendiumImport({
      pack: "dnd5e.monsters",
      entries: [{ name: "Goblin" }],
      folder: "f1",
    });
    expect(res.count).toBe(1);
    expect(res.documents[0]).toMatchObject({ name: "Goblin", folder: "f1" });
    expect(res.documents[0]._id).not.toBe("m1");
  });
});

describe("get_compendium_entry", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFakeGame({ packs: [monstersPack()] });
  });
  afterEach(() => restore());

  it("fetches a full entry by pack + name", async () => {
    const res = await handleCompendiumGetEntry({ pack: "dnd5e.monsters", entry: { name: "Goblin" } });
    expect(res.pack).toBe("dnd5e.monsters");
    expect(res.entry).toMatchObject({ name: "Goblin", system: { attributes: { hp: { value: 7 } }, details: { cr: 0.25 } } });
  });

  it("fetches a full entry by pack + _id", async () => {
    const res = await handleCompendiumGetEntry({ pack: "dnd5e.monsters", entry: { _id: "m2" } });
    expect(res.entry).toMatchObject({ name: "Orc" });
  });

  it("compact mode drops the long biography but keeps stats", async () => {
    const full = await handleCompendiumGetEntry({ pack: "dnd5e.monsters", entry: { _id: "m1" } });
    expect((full.entry.system as { details: { biography?: unknown } }).details.biography).toBeDefined();
    const compact = await handleCompendiumGetEntry({ pack: "dnd5e.monsters", entry: { _id: "m1" }, compact: true });
    const sys = compact.entry.system as { details: { biography?: unknown; cr?: number }; attributes: { hp: { value: number } } };
    expect(sys.details.biography).toBeUndefined();
    expect(sys.details.cr).toBe(0.25);
    expect(sys.attributes.hp.value).toBe(7);
  });

  it("NOT_FOUND for a missing entry", async () => {
    await expect(
      handleCompendiumGetEntry({ pack: "dnd5e.monsters", entry: { name: "Tarrasque" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resolves by uuid via the global fromUuid", async () => {
    (globalThis as Record<string, unknown>).fromUuid = async (uuid: string) =>
      uuid.endsWith(".m3") ? { toObject: () => ({ _id: "m3", name: "Adult Red Dragon", system: { details: { cr: 17 } } }) } : null;
    const res = await handleCompendiumGetEntry({ uuid: "Compendium.dnd5e.monsters.Actor.m3" });
    expect(res).toMatchObject({ pack: "dnd5e.monsters", entry: { name: "Adult Red Dragon" } });
    await expect(
      handleCompendiumGetEntry({ uuid: "Compendium.dnd5e.monsters.Actor.nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    delete (globalThis as Record<string, unknown>).fromUuid;
  });
});

describe("compendium cross-pack search + creature filters", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFakeGame({
      packs: [
        monstersPack(),
        makePack({
          id: "world.homebrew",
          documentName: "Item",
          entries: [
            { _id: "i1", name: "Goblin Cleaver", type: "weapon", uuid: "Compendium.world.homebrew.Item.i1" },
          ],
        }),
      ],
    });
  });
  afterEach(() => restore());

  it("searches all packs when pack is omitted, tagging each entry's source", async () => {
    const res = await handleCompendiumSearch({ query: "goblin" });
    expect(res.pack).toBeNull();
    const packs = res.entries.map((e) => e.pack).sort();
    expect(packs).toEqual(["dnd5e.monsters", "world.homebrew"]);
  });

  it("document_type restricts which packs are scanned", async () => {
    const res = await handleCompendiumSearch({ query: "goblin", document_type: "Item" });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({ name: "Goblin Cleaver", pack: "world.homebrew" });
  });

  it("caps merged results at the limit", async () => {
    const res = await handleCompendiumSearch({ limit: 2 });
    expect(res.entries).toHaveLength(2);
  });

  it("filters creatures by exact CR", async () => {
    const res = await handleCompendiumSearch({ pack: "dnd5e.monsters", cr: 17 });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({ name: "Adult Red Dragon", cr: 17, size: "huge" });
  });

  it("filters creatures by CR range and type", async () => {
    const range = await handleCompendiumSearch({ pack: "dnd5e.monsters", cr_min: 1, cr_max: 17 });
    expect(range.entries.map((e) => e.name).sort()).toEqual(["Adult Red Dragon", "Orc"]);
    const dragons = await handleCompendiumSearch({ pack: "dnd5e.monsters", creature_type: "dragon" });
    expect(dragons.entries).toHaveLength(1);
    expect(dragons.entries[0]).toMatchObject({ name: "Adult Red Dragon" });
  });

  it("excludes entries missing CR when a CR filter is active", async () => {
    const restore2 = installFakeGame({
      packs: [
        makePack({
          id: "dnd5e.npcs",
          entries: [
            { _id: "n1", name: "Commoner", type: "npc", system: { details: { type: { value: "humanoid" } } } },
            { _id: "n2", name: "Bandit", type: "npc", system: { details: { cr: 0.125, type: { value: "humanoid" } } } },
          ],
        }),
      ],
    });
    const res = await handleCompendiumSearch({ pack: "dnd5e.npcs", cr_min: 0 });
    expect(res.entries.map((e) => e.name)).toEqual(["Bandit"]);
    restore2();
  });
});

describe("compendium export", () => {
  function exportPack(locked = false, documentName = "Actor") {
    return {
      metadata: { id: "world.my-monsters", label: "My Monsters", type: documentName },
      documentName,
      locked,
      getIndex: async () => ({ contents: [] }),
      getDocument: async () => undefined,
    };
  }

  it("exports a world actor into an unlocked pack, stripping _id/folder", async () => {
    const restore = installFakeGame({
      packs: [exportPack(false)],
      actors: [{ _id: "a1", name: "Custom Dragon", folder: "f1" }],
    });
    const res = await handleCompendiumExport({
      pack: "world.my-monsters",
      type: "Actor",
      entries: [{ _id: "a1" }],
    });
    expect(res.count).toBe(1);
    expect(res.documents[0]).toMatchObject({ name: "Custom Dragon" });
    restore();
  });

  it("FORBIDDEN when the pack is locked", async () => {
    const restore = installFakeGame({
      packs: [exportPack(true)],
      actors: [{ _id: "a1", name: "X" }],
    });
    await expect(
      handleCompendiumExport({ pack: "world.my-monsters", type: "Actor", entries: [{ _id: "a1" }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    restore();
  });

  it("BAD_REQUEST when the pack holds a different type", async () => {
    const restore = installFakeGame({
      packs: [exportPack(false, "Item")],
      actors: [{ _id: "a1", name: "X" }],
    });
    await expect(
      handleCompendiumExport({ pack: "world.my-monsters", type: "Actor", entries: [{ _id: "a1" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    restore();
  });
});

describe("compendium create / delete", () => {
  it("creates a new world pack via CompendiumCollection.createCompendium", async () => {
    const restore = installFakeGame({ packs: [] });
    let createdWith: Record<string, unknown> | undefined;
    (globalThis as Record<string, unknown>).CompendiumCollection = {
      createCompendium: async (metadata: Record<string, unknown>) => {
        createdWith = metadata;
        return { metadata: { id: "world.homebrew-items", label: metadata.label } };
      },
    };
    const res = await handleCompendiumCreate({ label: "Homebrew Items", type: "Item" });
    expect(createdWith).toMatchObject({ type: "Item", label: "Homebrew Items" });
    expect(res).toMatchObject({ id: "world.homebrew-items", label: "Homebrew Items", type: "Item" });
    delete (globalThis as Record<string, unknown>).CompendiumCollection;
    restore();
  });

  it("rejects an unknown pack type with BAD_REQUEST", async () => {
    const restore = installFakeGame({ packs: [] });
    (globalThis as Record<string, unknown>).CompendiumCollection = { createCompendium: async () => ({}) };
    await expect(
      handleCompendiumCreate({ label: "X", type: "Bogus" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    delete (globalThis as Record<string, unknown>).CompendiumCollection;
    restore();
  });

  it("deletes a pack via deleteCompendium()", async () => {
    let deleted = false;
    const restore = installFakeGame({
      packs: [
        {
          metadata: { id: "world.homebrew-items", label: "Homebrew", type: "Item" },
          documentName: "Item",
          getIndex: async () => ({ contents: [] }),
          getDocument: async () => undefined,
          deleteCompendium: async () => {
            deleted = true;
          },
        },
      ],
    });
    const res = await handleCompendiumDelete({ pack: "world.homebrew-items" });
    expect(res).toMatchObject({ pack: "world.homebrew-items", deleted: true });
    expect(deleted).toBe(true);
    restore();
  });
});

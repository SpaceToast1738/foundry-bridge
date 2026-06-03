import {
  handleCompendiumImport,
  handleCompendiumList,
  handleCompendiumSearch,
} from "../src/handlers/compendium";
import { installFakeGame } from "./helpers/fake-game";

function fakePack() {
  const index = {
    contents: [
      { _id: "m1", name: "Goblin", type: "npc", uuid: "Compendium.dnd5e.monsters.m1", img: "g.png" },
      { _id: "m2", name: "Orc", type: "npc", uuid: "Compendium.dnd5e.monsters.m2" },
    ],
  };
  return {
    metadata: { id: "dnd5e.monsters", label: "Monsters", type: "Actor", system: "dnd5e", packageType: "system" },
    documentName: "Actor",
    getIndex: async () => index,
    getDocument: async (id: string) => {
      const e = index.contents.find((x) => x._id === id);
      return { toObject: () => ({ _id: id, name: e?.name, type: "npc", system: {} }) };
    },
  };
}

describe("compendium handlers", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFakeGame({
      packs: [fakePack()],
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

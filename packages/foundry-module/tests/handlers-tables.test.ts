import { handleTableCreate, handleTableAddResults } from "../src/handlers/tables";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

describe("table handlers", () => {
  it("creates a roll table", async () => {
    const restore = installFakeGame({});
    const res = await handleTableCreate({ name: "Loot", formula: "1d6" });
    expect(res).toMatchObject({ name: "Loot" });
    restore();
  });

  it("adds results and normalises", async () => {
    const added: Record<string, unknown>[] = [];
    let normalised = 0;
    const table: FakeDoc = {
      _id: "rt1",
      id: "rt1",
      name: "Loot",
      results: { contents: added },
      createEmbeddedDocuments: async (_n: string, data: Record<string, unknown>[]) => {
        added.push(...data);
        return data;
      },
      normalize: async () => { normalised++; },
    };
    const restore = installFakeGame({ tables: [table] });
    const res = await handleTableAddResults({ table: { _id: "rt1" }, results: ["sword", { text: "gold", weight: 3 }] });
    expect(res).toMatchObject({ table: "rt1", added: 2 });
    expect(added).toEqual([
      { type: "text", name: "sword", text: "sword", weight: 1, range: [1, 1] },
      { type: "text", name: "gold", text: "gold", weight: 3, range: [1, 1] },
    ]);
    expect(normalised).toBe(1);
    restore();
  });
});

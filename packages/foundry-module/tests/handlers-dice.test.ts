import { handleDiceRoll, handleTableDraw } from "../src/handlers/dice";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

function installRoll(): void {
  (globalThis as Record<string, unknown>).Roll = class {
    total = 14;
    result = "9 + 5";
    dice = [{ faces: 20, results: [{ result: 9 }] }];
    constructor(public formula: string, public data?: unknown) {}
    async evaluate() {
      return this;
    }
  };
}

function makeTable(): FakeDoc {
  return {
    _id: "rt1",
    name: "Loot",
    draw: async (_opts: Record<string, unknown>) => ({
      roll: { total: 7 },
      results: [{ text: "A rusty dagger", documentUuid: "Item.abc", img: "d.png" }],
    }),
  };
}

describe("dice & table handlers", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFakeGame({ tables: [makeTable()] });
    installRoll();
  });
  afterEach(() => {
    restore();
    delete (globalThis as Record<string, unknown>).Roll;
  });

  it("evaluates a roll formula", async () => {
    const res = await handleDiceRoll({ formula: "1d20+5" });
    expect(res).toMatchObject({ formula: "1d20+5", total: 14, result: "9 + 5" });
    expect((res.dice as unknown[])[0]).toMatchObject({ faces: 20, results: [9] });
  });

  it("draws from a roll table without chat side effects", async () => {
    const res = await handleTableDraw({ ref: { name: "Loot" } });
    expect(res).toMatchObject({ table: "Loot", total: 7 });
    expect((res.results as unknown[])[0]).toMatchObject({ text: "A rusty dagger", documentUuid: "Item.abc" });
  });

  it("NOT_FOUND for an unknown table", async () => {
    await expect(handleTableDraw({ ref: { name: "Nope" } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

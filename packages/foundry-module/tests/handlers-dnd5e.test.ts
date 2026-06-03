import {
  handleDnd5eActorSummary,
  handleDnd5eApplyDamage,
  handleDnd5eApplyHealing,
  handleDnd5eRest,
  handleDnd5eRoll,
} from "../src/systems/dnd5e";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

interface Dnd5eCalls {
  damage: unknown[][];
  rests: string[];
}

function make5eActor(calls: Dnd5eCalls): FakeDoc {
  return {
    _id: "a1",
    id: "a1",
    name: "Goblin",
    system: {
      attributes: { hp: { value: 7, max: 7, temp: 0 }, ac: { value: 15 } },
      abilities: { dex: { value: 14, mod: 2 }, str: { value: 8, mod: -1 } },
      details: { cr: 0.25 },
    },
    applyDamage: async (...args: unknown[]) => {
      calls.damage.push(args);
    },
    update: async (d: Record<string, unknown>) => d,
    rollSavingThrow: async (_cfg: Record<string, unknown>) => ({ total: 17 }),
    rollSkill: async (_cfg: Record<string, unknown>) => ({ total: 12 }),
    rollDeathSave: async () => ({ total: 10 }),
    longRest: async (_cfg: Record<string, unknown>) => {
      calls.rests.push("long");
    },
    shortRest: async (_cfg: Record<string, unknown>) => {
      calls.rests.push("short");
    },
  };
}

describe("dnd5e adapter", () => {
  let restore: () => void;
  let calls: Dnd5eCalls;

  beforeEach(() => {
    calls = { damage: [], rests: [] };
    restore = installFakeGame({
      actors: [make5eActor(calls)],
      system: { id: "dnd5e", version: "5.3.3" },
    });
  });
  afterEach(() => restore());

  it("applies typed damage via the array form", async () => {
    const res = await handleDnd5eApplyDamage({ actor: { _id: "a1" }, amount: 6, type: "fire" });
    expect(res).toMatchObject({ actor: "a1", damage: 6, type: "fire" });
    expect(calls.damage[0][0]).toEqual([{ value: 6, type: "fire" }]);
  });

  it("grants temp HP via the temphp type", async () => {
    await handleDnd5eApplyHealing({ actor: { _id: "a1" }, amount: 5, temp: true });
    expect(calls.damage[0][0]).toEqual([{ value: 5, type: "temphp" }]);
  });

  it("rolls a saving throw and returns the total", async () => {
    const res = await handleDnd5eRoll({ actor: { _id: "a1" }, kind: "save", key: "dex" });
    expect(res).toMatchObject({ kind: "save", key: "dex", total: 17 });
  });

  it("requires a key for skill rolls", async () => {
    await expect(
      handleDnd5eRoll({ actor: { _id: "a1" }, kind: "skill" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("takes a long rest", async () => {
    const res = await handleDnd5eRest({ actor: { _id: "a1" }, type: "long" });
    expect(res).toMatchObject({ rest: "long" });
    expect(calls.rests).toEqual(["long"]);
  });

  it("summarises the 5e sheet", () => {
    const res = handleDnd5eActorSummary({ actor: { _id: "a1" } });
    expect(res).toMatchObject({
      name: "Goblin",
      ac: 15,
      cr: 0.25,
      abilities: { dex: { value: 14, mod: 2 } },
    });
  });

  it("is gated to the dnd5e system", () => {
    restore();
    restore = installFakeGame({ actors: [make5eActor(calls)], system: { id: "pf2e", version: "1" } });
    expect(() => handleDnd5eActorSummary({ actor: { _id: "a1" } })).toThrow();
  });
});

import {
  handleDnd5eActorSummary,
  handleDnd5eApplyDamage,
  handleDnd5eApplyHealing,
  handleDnd5eAwardXp,
  handleDnd5eConcentration,
  handleDnd5eCurrency,
  handleDnd5eDeathSaves,
  handleDnd5eHitDice,
  handleDnd5eItemRoll,
  handleDnd5eRest,
  handleDnd5eRoll,
  handleDnd5eSpellSlots,
  handleDnd5eUseItem,
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

describe("dnd5e depth (round 7)", () => {
  let restore: () => void;
  let updates: Record<string, unknown>[];

  function richActor(): FakeDoc {
    return {
      _id: "pc",
      id: "pc",
      name: "Mage",
      system: {
        spells: { spell1: { value: 4, max: 4 }, spell3: { value: 2, max: 3 }, pact: { value: 1, max: 2 } },
        currency: { gp: 10, sp: 5, cp: 0 },
        details: { xp: { value: 900, max: 2700 } },
        attributes: { hd: { value: 3, max: 5 }, death: { success: 0, failure: 0 } },
      },
      concentration: { effects: { size: 1 } },
      endConcentration: async () => undefined,
      update: async (d: Record<string, unknown>) => {
        updates.push(d);
        return d;
      },
    } as unknown as FakeDoc;
  }

  beforeEach(() => {
    updates = [];
    restore = installFakeGame({ actors: [richActor()], system: { id: "dnd5e", version: "5.3.3" } });
  });
  afterEach(() => restore());

  it("uses a spell slot (clamped) ", async () => {
    const r = await handleDnd5eSpellSlots({ actor: { _id: "pc" }, level: 3, action: "use", amount: 1 });
    expect(r).toMatchObject({ level: 3, value: 1, max: 3 });
    expect(updates[0]).toEqual({ "system.spells.spell3.value": 1 });
  });

  it("recovers a pact slot up to max", async () => {
    const r = await handleDnd5eSpellSlots({ actor: { _id: "pc" }, level: "pact", action: "recover", amount: 5 });
    expect(r).toMatchObject({ level: "pact", value: 2, max: 2 });
  });

  it("adds and sets currency", async () => {
    const add = await handleDnd5eCurrency({ actor: { _id: "pc" }, mode: "add", changes: { gp: 5, sp: -2 } });
    expect(add).toMatchObject({ currency: { gp: 15, sp: 3 } });
    const set = await handleDnd5eCurrency({ actor: { _id: "pc" }, mode: "set", changes: { gp: 100 } });
    expect(set).toMatchObject({ currency: { gp: 100 } });
  });

  it("awards xp and flags a level-up threshold", async () => {
    const r = await handleDnd5eAwardXp({ actor: { _id: "pc" }, amount: 2000 });
    expect(r).toMatchObject({ xp: 2900, threshold: 2700, levelUpAvailable: true });
  });

  it("spends hit dice", async () => {
    const r = await handleDnd5eHitDice({ actor: { _id: "pc" }, action: "spend", amount: 2 });
    expect(r).toMatchObject({ hitDice: 1, max: 5 });
  });

  it("sets death-save counters", async () => {
    const r = await handleDnd5eDeathSaves({ actor: { _id: "pc" }, successes: 2, failures: 1 });
    expect(r).toMatchObject({ death: { success: 2, failure: 1 } });
    expect(updates[0]).toMatchObject({
      "system.attributes.death.success": 2,
      "system.attributes.death.failure": 1,
    });
  });

  it("checks and breaks concentration", async () => {
    const chk = await handleDnd5eConcentration({ actor: { _id: "pc" }, action: "check" });
    expect(chk).toMatchObject({ concentrating: true, count: 1 });
    const brk = await handleDnd5eConcentration({ actor: { _id: "pc" }, action: "break" });
    expect(brk).toMatchObject({ concentrating: false, broke: 1 });
  });
});

describe("dnd5e item use / rolls", () => {
  let restore: () => void;
  let used: boolean;

  function actorWithItem(): FakeDoc {
    used = false;
    const item = {
      _id: "i1",
      id: "i1",
      name: "Longsword",
      use: async () => {
        used = true;
        return { foo: 1 };
      },
      rollAttack: async () => ({ total: 18 }),
      rollDamage: async () => ({ total: 9 }),
    };
    return {
      _id: "pc",
      id: "pc",
      name: "Fighter",
      system: {},
      items: { contents: [item], get: (id: string) => (id === "i1" ? item : undefined) },
      update: async () => undefined,
    } as unknown as FakeDoc;
  }

  beforeEach(() => {
    restore = installFakeGame({ actors: [actorWithItem()], system: { id: "dnd5e", version: "5.3.3" } });
  });
  afterEach(() => restore());

  it("uses an item by name", async () => {
    const r = await handleDnd5eUseItem({ actor: { _id: "pc" }, item: { name: "Longsword" } });
    expect(r).toMatchObject({ item: "i1", used: true });
    expect(used).toBe(true);
  });

  it("rolls an item attack and damage, returning totals", async () => {
    const atk = await handleDnd5eItemRoll({ actor: { _id: "pc" }, item: { _id: "i1" }, kind: "attack" });
    expect(atk).toMatchObject({ kind: "attack", total: 18 });
    const dmg = await handleDnd5eItemRoll({ actor: { _id: "pc" }, item: { _id: "i1" }, kind: "damage" });
    expect(dmg).toMatchObject({ kind: "damage", total: 9 });
  });

  it("NOT_FOUND for a missing item", async () => {
    await expect(
      handleDnd5eUseItem({ actor: { _id: "pc" }, item: { name: "Bow" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

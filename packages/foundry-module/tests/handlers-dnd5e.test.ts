import {
  handleDnd5eActorSummary,
  handleDnd5eApplyDamage,
  handleDnd5eApplyHealing,
  handleDnd5eAwardXp,
  handleDnd5eConcentration,
  handleDnd5eCurrency,
  handleDnd5eDeathSaves,
  handleDnd5eEncounterBudget,
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

interface RollLog {
  saveCfg: Record<string, unknown>[];
  skillCfg: Record<string, unknown>[];
  concCfg: Record<string, unknown>[];
  damage: unknown[][];
  updates: Record<string, unknown>[];
  rests: string[];
}

function newLog(): RollLog {
  return { saveCfg: [], skillCfg: [], concCfg: [], damage: [], updates: [], rests: [] };
}

/** An actor that captures the config passed to each roll method so tests can
 * assert modifiers threaded through, plus damage/rest/update bookkeeping. */
function rollActor(
  id: string,
  log: RollLog,
  opts: { total?: number; concentrating?: boolean; xp?: number; xpMax?: number; gp?: number } = {},
): FakeDoc {
  const total = opts.total ?? 15;
  return {
    _id: id,
    id,
    name: id,
    system: {
      attributes: { hp: { value: 10, max: 10, temp: 0 } },
      abilities: { con: { value: 12, mod: 1 }, dex: { value: 14, mod: 2 } },
      currency: { gp: opts.gp ?? 0 },
      details: { xp: { value: opts.xp ?? 0, max: opts.xpMax ?? 300 } },
    },
    concentration: { effects: { size: opts.concentrating ? 1 : 0 } },
    endConcentration: async () => undefined,
    applyDamage: async (...args: unknown[]) => {
      log.damage.push([id, ...args]);
    },
    update: async (d: Record<string, unknown>) => {
      log.updates.push({ id, ...d });
      return d;
    },
    rollSavingThrow: async (cfg: Record<string, unknown>) => {
      log.saveCfg.push(cfg);
      return { total };
    },
    rollSkill: async (cfg: Record<string, unknown>) => {
      log.skillCfg.push(cfg);
      return { total };
    },
    rollConcentration: async (cfg: Record<string, unknown>) => {
      log.concCfg.push(cfg);
      return { total };
    },
    longRest: async () => {
      log.rests.push(`${id}:long`);
    },
    shortRest: async () => {
      log.rests.push(`${id}:short`);
    },
  } as unknown as FakeDoc;
}

describe("dnd5e Batch 3 — live-session", () => {
  let restore: () => void;
  let log: RollLog;
  beforeEach(() => {
    log = newLog();
  });
  afterEach(() => restore());

  function install(actors: FakeDoc[]): void {
    restore = installFakeGame({ actors, system: { id: "dnd5e", version: "5.3.3" } });
  }

  it("threads advantage into the roll config", async () => {
    install([rollActor("a1", log)]);
    await handleDnd5eRoll({ actor: { _id: "a1" }, kind: "save", key: "dex", advantage: true });
    expect(log.saveCfg[0]).toMatchObject({ ability: "dex", advantage: true });
  });

  it("threads disadvantage and a flat bonus as a roll part", async () => {
    install([rollActor("a1", log)]);
    await handleDnd5eRoll({ actor: { _id: "a1" }, kind: "save", key: "con", disadvantage: true, bonus: "+2" });
    expect(log.saveCfg[0]).toMatchObject({ disadvantage: true, rolls: [{ parts: ["+2"] }] });
  });

  it("evaluates a dc into success", async () => {
    install([rollActor("a1", log, { total: 17 })]);
    const pass = await handleDnd5eRoll({ actor: { _id: "a1" }, kind: "save", key: "dex", dc: 15 });
    expect(pass).toMatchObject({ dc: 15, success: true, total: 17 });
    const fail = await handleDnd5eRoll({ actor: { _id: "a1" }, kind: "save", key: "dex", dc: 20 });
    expect(fail).toMatchObject({ dc: 20, success: false });
  });

  it("rolls for a whole party via actors[]", async () => {
    install([rollActor("a1", log, { total: 12 }), rollActor("a2", log, { total: 18 })]);
    const res = (await handleDnd5eRoll({
      actors: [{ _id: "a1" }, { _id: "a2" }],
      kind: "save",
      key: "dex",
      dc: 15,
    })) as { results: Record<string, unknown>[] };
    expect(res.results).toHaveLength(2);
    expect(res.results[0]).toMatchObject({ actor: "a1", success: false });
    expect(res.results[1]).toMatchObject({ actor: "a2", success: true });
  });

  it("applies damage to multiple targets", async () => {
    install([rollActor("a1", log), rollActor("a2", log)]);
    const res = (await handleDnd5eApplyDamage({
      targets: [{ _id: "a1" }, { _id: "a2" }],
      amount: 8,
      type: "fire",
    })) as { results: Record<string, unknown>[] };
    expect(res.results).toHaveLength(2);
    expect(log.damage.map((d) => d[0])).toEqual(["a1", "a2"]);
  });

  it("rolls a concentration save on damage when concentrating", async () => {
    install([rollActor("a1", log, { total: 12, concentrating: true })]);
    const res = (await handleDnd5eApplyDamage({
      actor: { _id: "a1" },
      amount: 30,
      check_concentration: true,
    })) as { concentration: Record<string, unknown> };
    expect(res.concentration).toMatchObject({ wasConcentrating: true, dc: 15, save: 12, success: false });
    expect(log.concCfg[0]).toMatchObject({ target: 15 });
  });

  it("skips the concentration save when not concentrating", async () => {
    install([rollActor("a1", log, { concentrating: false })]);
    const res = (await handleDnd5eApplyDamage({
      actor: { _id: "a1" },
      amount: 30,
      check_concentration: true,
    })) as { concentration: Record<string, unknown> };
    expect(res.concentration).toMatchObject({ wasConcentrating: false, dc: 15 });
    expect(res.concentration.save).toBeUndefined();
    expect(log.concCfg).toHaveLength(0);
  });

  it("rolls a concentration save via the save action at a given dc", async () => {
    install([rollActor("a1", log, { total: 18, concentrating: true })]);
    const res = await handleDnd5eConcentration({ actor: { _id: "a1" }, action: "save", dc: 14 });
    expect(res).toMatchObject({ dc: 14, save: 18, success: true });
    expect(log.concCfg[0]).toMatchObject({ target: 14 });
  });

  it("scales the concentration DC by the damage multiplier", async () => {
    install([rollActor("a1", log, { total: 25, concentrating: true })]);
    const res = (await handleDnd5eApplyDamage({
      actor: { _id: "a1" },
      amount: 20,
      multiplier: 2,
      check_concentration: true,
    })) as { concentration: Record<string, unknown> };
    // applied = 40 → dc = max(10, floor(40/2)) = 20.
    expect(res.concentration).toMatchObject({ dc: 20 });
    expect(log.concCfg[0]).toMatchObject({ target: 20 });
  });

  it("does not roll a concentration save when no damage is applied", async () => {
    install([rollActor("a1", log, { concentrating: true })]);
    const res = (await handleDnd5eApplyDamage({
      actor: { _id: "a1" },
      amount: 10,
      multiplier: 0,
      check_concentration: true,
    })) as { concentration: Record<string, unknown> };
    expect(res.concentration).toMatchObject({ wasConcentrating: true });
    expect(res.concentration.dc).toBeUndefined();
    expect(res.concentration.save).toBeUndefined();
    expect(log.concCfg).toHaveLength(0);
  });

  it("splits XP removal symmetrically (trunc, not floor)", async () => {
    install([
      rollActor("a1", log, { xp: 100 }),
      rollActor("a2", log, { xp: 100 }),
      rollActor("a3", log, { xp: 100 }),
    ]);
    const res = (await handleDnd5eAwardXp({
      actors: [{ _id: "a1" }, { _id: "a2" }, { _id: "a3" }],
      amount: -100,
    })) as { awarded: number };
    // trunc(-100/3) = -33 per member (floor would over-remove at -34).
    expect(res.awarded).toBe(-33);
  });

  it("rests a whole party via actors[]", async () => {
    install([rollActor("a1", log), rollActor("a2", log)]);
    const res = (await handleDnd5eRest({
      actors: [{ _id: "a1" }, { _id: "a2" }],
      type: "short",
    })) as { results: Record<string, unknown>[] };
    expect(res.results).toHaveLength(2);
    expect(log.rests).toEqual(["a1:short", "a2:short"]);
  });

  it("splits xp across a party by default, full amount with each", async () => {
    install([rollActor("a1", log, { xp: 100 }), rollActor("a2", log, { xp: 100 })]);
    const split = (await handleDnd5eAwardXp({
      actors: [{ _id: "a1" }, { _id: "a2" }],
      amount: 100,
    })) as { awarded: number; results: Record<string, unknown>[] };
    expect(split.awarded).toBe(50);
    expect(split.results[0]).toMatchObject({ xp: 150, awarded: 50 });
    restore();

    log = newLog();
    install([rollActor("a1", log, { xp: 100 }), rollActor("a2", log, { xp: 100 })]);
    const each = (await handleDnd5eAwardXp({
      actors: [{ _id: "a1" }, { _id: "a2" }],
      amount: 100,
      each: true,
    })) as { awarded: number };
    expect(each.awarded).toBe(100);
  });

  it("applies currency to each party member", async () => {
    install([rollActor("a1", log, { gp: 10 }), rollActor("a2", log, { gp: 0 })]);
    const res = (await handleDnd5eCurrency({
      actors: [{ _id: "a1" }, { _id: "a2" }],
      mode: "add",
      changes: { gp: 5 },
    })) as { results: Record<string, unknown>[] };
    expect(res.results).toHaveLength(2);
    expect(res.results[0]).toMatchObject({ currency: { gp: 15 } });
    expect(res.results[1]).toMatchObject({ currency: { gp: 5 } });
  });

  it("expands a Group actor to its members for a rest", async () => {
    const a1 = rollActor("a1", log);
    const a2 = rollActor("a2", log);
    const group = {
      _id: "g1",
      id: "g1",
      name: "Party",
      type: "group",
      system: { members: [{ actor: a1 }, { actor: a2 }] },
      update: async () => undefined,
    } as unknown as FakeDoc;
    install([a1, a2, group]);
    const res = (await handleDnd5eRest({ group: { _id: "g1" }, type: "long" })) as {
      results: Record<string, unknown>[];
    };
    expect(res.results).toHaveLength(2);
    expect(log.rests).toEqual(["a1:long", "a2:long"]);
  });

  it("back-compat: a single actor still returns a flat object", async () => {
    install([rollActor("a1", log)]);
    const res = await handleDnd5eRest({ actor: { _id: "a1" }, type: "long" });
    expect(res).toMatchObject({ actor: "a1", rest: "long" });
    expect(res).not.toHaveProperty("results");
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

describe("dnd5e encounter budget", () => {
  let restore: () => void;
  afterEach(() => restore());

  function install(opts: Record<string, unknown>): void {
    restore = installFakeGame({ system: { id: "dnd5e", version: "5.3.3" }, ...opts });
  }

  it("sums party thresholds from levels", async () => {
    install({});
    const res = (await handleDnd5eEncounterBudget({
      levels: [5, 5, 5, 5],
      monsters: [{ cr: 2 }],
    })) as { party: { thresholds: Record<string, number> }; monsters: Record<string, number>; difficulty: string };
    // 4 x level-5 row [250,500,750,1100].
    expect(res.party.thresholds).toEqual({ easy: 1000, medium: 2000, hard: 3000, deadly: 4400 });
    // CR 2 = 450 XP, 1 monster, x1 → 450, below easy → trivial.
    expect(res.monsters).toMatchObject({ count: 1, rawXp: 450, multiplier: 1, adjustedXp: 450 });
    expect(res.difficulty).toBe("trivial");
  });

  it("applies the count multiplier and bands a deadly fight", async () => {
    install({});
    const res = (await handleDnd5eEncounterBudget({
      levels: [5, 5, 5, 5],
      monsters: [{ cr: 5, count: 4 }],
    })) as { monsters: Record<string, number>; difficulty: string };
    // CR 5 = 1800 each, 4 monsters → raw 7200, x2 → 14400.
    expect(res.monsters).toMatchObject({ count: 4, rawXp: 7200, multiplier: 2, adjustedXp: 14400 });
    expect(res.difficulty).toBe("deadly");
  });

  it("scores fractional CRs correctly", async () => {
    install({});
    const res = (await handleDnd5eEncounterBudget({
      levels: [1],
      monsters: [{ cr: 0.25 }, { cr: 0.125 }, { cr: 0.5 }],
    })) as { monsters: Record<string, number> };
    // 50 + 25 + 100 = 175.
    expect(res.monsters.rawXp).toBe(175);
    expect(res.monsters.count).toBe(3);
  });

  it("reads party levels from actors", async () => {
    install({
      actors: [
        { _id: "p1", name: "P1", system: { details: { level: 5 } } },
        { _id: "p2", name: "P2", system: { details: { level: 3 } } },
      ],
    });
    const res = (await handleDnd5eEncounterBudget({
      actors: [{ _id: "p1" }, { _id: "p2" }],
      monsters: [{ cr: 1 }],
    })) as { party: { levels: number[]; size: number } };
    expect(res.party.levels.sort()).toEqual([3, 5]);
    expect(res.party.size).toBe(2);
  });

  it("reads CR from a compendium ref via the index", async () => {
    install({
      packs: [
        {
          metadata: { id: "dnd5e.monsters", type: "Actor" },
          documentName: "Actor",
          getIndex: async (_o?: { fields?: string[] }) => ({
            contents: [{ _id: "m1", name: "Goblin", system: { details: { cr: 0.25 } } }],
          }),
          getDocument: async () => undefined,
        },
      ],
    });
    const res = (await handleDnd5eEncounterBudget({
      levels: [1],
      monsters: [{ pack: "dnd5e.monsters", entry: { name: "Goblin" } }],
    })) as { monsters: Record<string, number> };
    expect(res.monsters.rawXp).toBe(50); // CR 0.25 = 50 XP.
  });

  it("shifts the multiplier column for a small party", async () => {
    install({});
    const res = (await handleDnd5eEncounterBudget({
      levels: [5, 5],
      party_size: 2,
      monsters: [{ cr: 1, count: 3 }],
    })) as { monsters: Record<string, number> };
    // 3 monsters → base tier x2; party_size 2 (<3) bumps to x2.5.
    expect(res.monsters.multiplier).toBe(2.5);
  });

  it("uses x0.5 for a 6+ party facing a single monster", async () => {
    install({});
    const res = (await handleDnd5eEncounterBudget({
      levels: [5, 5, 5, 5, 5, 5],
      monsters: [{ cr: 5 }],
    })) as { monsters: Record<string, number> };
    expect(res.monsters.multiplier).toBe(0.5);
    expect(res.monsters.adjustedXp).toBe(900); // 1800 * 0.5
  });

  it("rounds a fractional CR>=1 instead of mispricing it", async () => {
    install({});
    const res = (await handleDnd5eEncounterBudget({
      levels: [5],
      monsters: [{ cr: 1.5 }],
    })) as { monsters: Record<string, number> };
    // 1.5 rounds to CR 2 = 450 XP (not the 155000 fallback).
    expect(res.monsters.rawXp).toBe(450);
  });

  it("errors on a non-dnd5e world", async () => {
    install({});
    restore();
    restore = installFakeGame({ system: { id: "pf2e", version: "1" } });
    await expect(
      handleDnd5eEncounterBudget({ levels: [1], monsters: [{ cr: 1 }] }),
    ).rejects.toThrow();
  });
});

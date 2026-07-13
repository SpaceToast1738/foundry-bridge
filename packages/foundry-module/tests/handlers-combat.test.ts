import {
  handleCombatAdd,
  handleCombatAdvance,
  handleCombatantDamage,
  handleCombatCreate,
  handleCombatRollInitiative,
} from "../src/handlers/combat";
import { installFakeGame } from "./helpers/fake-game";

interface Calls {
  rollAll: number;
  rolled: string[][];
  started: number;
  next: number;
  nextRound: number;
  ended: number;
  damaged: string[];
}

function makeCombat(calls: Calls) {
  const actorFor = (id: string) => ({
    applyDamage: async (dmg: unknown[]) => {
      const value = (dmg[0] as { value?: number })?.value ?? dmg;
      calls.damaged.push(`${id}:${value}`);
    },
  });
  const combatants: Record<string, unknown>[] = [
    { id: "c1", name: "Goblin", initiative: null, tokenId: "t1", actor: actorFor("c1") },
    { id: "c2", name: "Bandit", initiative: null, tokenId: "t2", actor: actorFor("c2") },
  ];
  return {
    id: "cmb1",
    round: 0,
    turn: 0,
    scene: { id: "s1" },
    combatants: { contents: combatants, get: (id: string) => combatants.find((c) => c.id === id) },
    createEmbeddedDocuments: async (_n: string, data: Record<string, unknown>[]) => {
      const created = data.map((d, i) => ({ id: `c${i + 3}`, name: "Added", initiative: null, ...d }));
      combatants.push(...created);
      return created;
    },
    rollAll: async () => { calls.rollAll++; },
    rollInitiative: async (ids: string[]) => { calls.rolled.push(ids); },
    startCombat: async () => { calls.started++; },
    nextTurn: async () => { calls.next++; },
    previousTurn: async () => undefined,
    nextRound: async () => { calls.nextRound++; },
    previousRound: async () => undefined,
    endCombat: async () => { calls.ended++; },
    activate: async () => undefined,
  };
}

describe("combat handlers", () => {
  let restore: () => void;
  let calls: Calls;

  beforeEach(() => {
    calls = { rollAll: 0, rolled: [], started: 0, next: 0, nextRound: 0, ended: 0, damaged: [] };
    const combat = makeCombat(calls);
    restore = installFakeGame({ combat, scenes: [{ _id: "s1", id: "s1", name: "S" } as never], activeSceneId: "s1" });
    (globalThis as Record<string, unknown>).Combat = {
      create: async (_data: Record<string, unknown>) => makeCombat(calls),
    };
  });
  afterEach(() => {
    restore();
    delete (globalThis as Record<string, unknown>).Combat;
  });

  it("creates a combat", async () => {
    const res = await handleCombatCreate({});
    expect(res).toMatchObject({ _id: "cmb1", round: 0 });
  });

  it("adds combatants from token ids", async () => {
    const res = await handleCombatAdd({ tokens: ["t2", "t3"] });
    // 2 pre-existing combatants + 2 added.
    expect((res.combatants as unknown[]).length).toBe(4);
  });

  it("rolls initiative for all by default", async () => {
    await handleCombatRollInitiative({});
    expect(calls.rollAll).toBe(1);
  });

  it("rolls initiative for a subset", async () => {
    await handleCombatRollInitiative({ combatants: ["c1"] });
    expect(calls.rolled).toEqual([["c1"]]);
  });

  it("advances turns and ends combat", async () => {
    await handleCombatAdvance({ action: "next" });
    expect(calls.next).toBe(1);
    const ended = await handleCombatAdvance({ action: "end" });
    expect(ended).toMatchObject({ ended: true });
    expect(calls.ended).toBe(1);
  });

  it("advances a whole round", async () => {
    await handleCombatAdvance({ action: "next_round" });
    expect(calls.nextRound).toBe(1);
  });

  it("damages a single combatant", async () => {
    const res = await handleCombatantDamage({ combatant: "c1", amount: 5, type: "fire" });
    expect(res).toMatchObject({ combatant: "c1", damage: 5 });
    expect(calls.damaged).toEqual(["c1:5"]);
  });

  it("damages several combatants at once", async () => {
    const res = (await handleCombatantDamage({ combatants: ["c1", "c2"], amount: 4 })) as {
      results: Record<string, unknown>[];
    };
    expect(res.results).toHaveLength(2);
    expect(calls.damaged).toEqual(["c1:4", "c2:4"]);
  });

  it("BAD_REQUEST when neither combatant nor combatants is given", async () => {
    await expect(handleCombatantDamage({ amount: 4 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("NOT_FOUND advancing with no active combat", async () => {
    restore();
    restore = installFakeGame({});
    await expect(handleCombatAdvance({ action: "next" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

import {
  handleCombatAdd,
  handleCombatAdvance,
  handleCombatCreate,
  handleCombatRollInitiative,
} from "../src/handlers/combat";
import { installFakeGame } from "./helpers/fake-game";

interface Calls {
  rollAll: number;
  rolled: string[][];
  started: number;
  next: number;
  ended: number;
}

function makeCombat(calls: Calls) {
  const combatants: Record<string, unknown>[] = [
    { id: "c1", name: "Goblin", initiative: null, tokenId: "t1" },
  ];
  return {
    id: "cmb1",
    round: 0,
    turn: 0,
    scene: { id: "s1" },
    combatants: { contents: combatants },
    createEmbeddedDocuments: async (_n: string, data: Record<string, unknown>[]) => {
      const created = data.map((d, i) => ({ id: `c${i + 2}`, name: "Added", initiative: null, ...d }));
      combatants.push(...created);
      return created;
    },
    rollAll: async () => { calls.rollAll++; },
    rollInitiative: async (ids: string[]) => { calls.rolled.push(ids); },
    startCombat: async () => { calls.started++; },
    nextTurn: async () => { calls.next++; },
    previousTurn: async () => undefined,
    endCombat: async () => { calls.ended++; },
    activate: async () => undefined,
  };
}

describe("combat handlers", () => {
  let restore: () => void;
  let calls: Calls;

  beforeEach(() => {
    calls = { rollAll: 0, rolled: [], started: 0, next: 0, ended: 0 };
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
    expect((res.combatants as unknown[]).length).toBe(3);
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

  it("NOT_FOUND advancing with no active combat", async () => {
    restore();
    restore = installFakeGame({});
    await expect(handleCombatAdvance({ action: "next" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

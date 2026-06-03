import {
  handleActorApplyDamage,
  handleActorApplyHealing,
  handleActorAssign,
  handleActorCreate,
  handleActorGrantItem,
  handleActorRollData,
  handleActorToggleCondition,
  handleConditionsList,
} from "../src/handlers/actors";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

interface ActorCalls {
  toggled: { id: string; active?: boolean }[];
  updated: Record<string, unknown>[];
  damage: number[];
  items: Record<string, unknown>[];
}

function makeActor(calls: ActorCalls): FakeDoc {
  return {
    _id: "a1",
    id: "a1",
    name: "Goblin",
    ownership: { default: 0 },
    getRollData: () => ({ abilities: { dex: { mod: 3 } } }),
    toggleStatusEffect: async (id: string, opts?: { active?: boolean }) => {
      calls.toggled.push({ id, active: opts?.active });
      return true;
    },
    update: async (data: Record<string, unknown>) => {
      calls.updated.push(data);
      return data;
    },
    createEmbeddedDocuments: async (_n: string, data: Record<string, unknown>[]) => {
      calls.items.push(...data);
      return data.map((d, i) => ({ _id: `i${i}`, ...d }));
    },
    applyDamage: async (amount: number) => {
      calls.damage.push(amount);
      return undefined;
    },
  };
}

describe("actor handlers", () => {
  let restore: () => void;
  let calls: ActorCalls;

  beforeEach(() => {
    calls = { toggled: [], updated: [], damage: [], items: [] };
    restore = installFakeGame({
      actors: [makeActor(calls)],
      users: [{ _id: "u1", name: "Alice" } as never],
    });
    (globalThis as Record<string, unknown>).CONFIG = {
      statusEffects: [
        { id: "prone", name: "Prone", img: "prone.svg" },
        { id: "poisoned", label: "Poisoned", icon: "pois.svg" },
      ],
    };
  });
  afterEach(() => {
    restore();
    delete (globalThis as Record<string, unknown>).CONFIG;
  });

  it("creates an actor", async () => {
    const res = await handleActorCreate({ name: "Bandit", type: "npc" });
    expect(res).toMatchObject({ name: "Bandit", type: "npc" });
  });

  it("grants an inline item", async () => {
    const res = await handleActorGrantItem({ actor: { _id: "a1" }, item: { name: "Dagger", type: "weapon" } });
    expect(res).toMatchObject({ actor: "a1", count: 1 });
    expect(calls.items[0]).toMatchObject({ name: "Dagger" });
  });

  it("rejects grant_item with no source", async () => {
    await expect(handleActorGrantItem({ actor: { _id: "a1" } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("lists conditions (normalising name/img)", () => {
    const res = handleConditionsList();
    expect(res.count).toBe(2);
    expect(res.conditions).toEqual([
      { id: "prone", name: "Prone", img: "prone.svg" },
      { id: "poisoned", name: "Poisoned", img: "pois.svg" },
    ]);
  });

  it("toggles a condition", async () => {
    await handleActorToggleCondition({ actor: { _id: "a1" }, condition: "prone", active: true });
    expect(calls.toggled).toEqual([{ id: "prone", active: true }]);
  });

  it("returns roll data", () => {
    const res = handleActorRollData({ actor: { _id: "a1" } });
    expect(res).toMatchObject({ abilities: { dex: { mod: 3 } } });
  });

  it("assigns ownership to a user", async () => {
    const res = await handleActorAssign({ actor: { _id: "a1" }, user: { name: "Alice" } });
    expect(res).toMatchObject({ actor: "a1", user: "u1", level: 3 });
    expect(calls.updated[0]).toMatchObject({ ownership: { default: 0, u1: 3 } });
  });

  it("applies damage and healing via applyDamage", async () => {
    await handleActorApplyDamage({ actor: { _id: "a1" }, amount: 7 });
    await handleActorApplyHealing({ actor: { _id: "a1" }, amount: 4 });
    expect(calls.damage).toEqual([7, -4]);
  });

  it("UNAVAILABLE when applyDamage is absent", async () => {
    restore();
    restore = installFakeGame({ actors: [{ _id: "a2", id: "a2", name: "Rock" } as never] });
    await expect(
      handleActorApplyDamage({ actor: { _id: "a2" }, amount: 5 }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

import { handleSceneUpdate, handleSceneResetFog } from "../src/handlers/scenes";
import {
  handleCombatAdvance,
  handleCombatRemove,
  handleCombatSetInitiative,
} from "../src/handlers/combat";
import { handleMacroExecute } from "../src/handlers/macro";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

describe("scene environment", () => {
  it("updates a scene and resets fog", async () => {
    const calls: Record<string, unknown> = {};
    let fog = 0;
    const scene: FakeDoc = {
      _id: "s1", id: "s1", name: "Map",
      update: async (d: Record<string, unknown>) => { Object.assign(calls, d); },
      resetFog: async () => { fog++; },
    };
    const restore = installFakeGame({ scenes: [scene], activeSceneId: "s1" });
    await handleSceneUpdate({ updates: { darkness: 0.7 } });
    expect(calls).toMatchObject({ darkness: 0.7 });
    const r = await handleSceneResetFog({});
    expect(r).toMatchObject({ scene: "s1", fogReset: true });
    expect(fog).toBe(1);
    restore();
  });
});

describe("combat depth", () => {
  function makeCombat(calls: string[]) {
    const combatants = [{ id: "c1", name: "Goblin", initiative: null, tokenId: "t1" }];
    return {
      id: "cmb1", round: 1, turn: 0, scene: { id: "s1" },
      combatants: { contents: combatants },
      setInitiative: async (id: string, v: number) => { calls.push(`init:${id}=${v}`); },
      deleteEmbeddedDocuments: async (_n: string, ids: string[]) => { calls.push("rm:" + ids.join(",")); return ids; },
      nextRound: async () => { calls.push("nextRound"); },
      previousRound: async () => { calls.push("prevRound"); },
      nextTurn: async () => {}, previousTurn: async () => {}, startCombat: async () => {},
      endCombat: async () => {}, rollAll: async () => {}, rollInitiative: async () => {},
      createEmbeddedDocuments: async () => [],
    };
  }
  it("sets initiative, removes combatants, advances rounds", async () => {
    const calls: string[] = [];
    const restore = installFakeGame({ combat: makeCombat(calls) });
    await handleCombatSetInitiative({ combatant: "c1", value: 17 });
    await handleCombatRemove({ combatants: ["c1"] });
    await handleCombatAdvance({ action: "next_round" });
    await handleCombatAdvance({ action: "previous_round" });
    expect(calls).toEqual(["init:c1=17", "rm:c1", "nextRound", "prevRound"]);
    restore();
  });
});

describe("execute_macro", () => {
  it("runs a macro and reports a simple result", async () => {
    let ran = false;
    const macro: FakeDoc = {
      _id: "m1", id: "m1", name: "Test Macro",
      execute: async () => { ran = true; return 42; },
    };
    const restore = installFakeGame({ macros: [macro] });
    const r = await handleMacroExecute({ macro: { _id: "m1" } });
    expect(r).toMatchObject({ macro: "m1", executed: true, result: 42 });
    expect(ran).toBe(true);
    restore();
  });
});

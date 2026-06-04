import { ErrorCode } from "@foundry-bridge/shared";
import { handleStatusGet } from "../src/handlers/status";
import {
  handleCardsDeal,
  handleCardsDraw,
  handleCardsPass,
  handleCardsReset,
  handleCardsShuffle,
} from "../src/handlers/cards";
import { handleTimeAdvance, handleTimeSet } from "../src/handlers/time";
import { handleWallsDraw } from "../src/handlers/scenes";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

describe("get_status", () => {
  it("reports module version, world descriptor and tier states", () => {
    const restore = installFakeGame({
      world: { id: "w1", title: "Test World" },
      system: { id: "dnd5e", version: "5.3.3" },
      version: "14.363",
      actors: [{ _id: "a1", name: "NPC" }],
      modules: { "foundry-bridge": { version: "0.2.0", active: true } },
      settings: { writeEnabled: true, destructiveEnabled: false, maxDeletePerCall: 5 },
    });
    const r = handleStatusGet();
    expect(r.moduleConnected).toBe(true);
    expect(r.moduleVersion).toBe("0.2.0");
    expect(r.world.title).toBe("Test World");
    expect(r.world.counts.actors).toBe(1);
    expect(r.tiers).toMatchObject({
      isGM: true,
      writeEnabled: true,
      destructiveEnabled: false,
    });
    restore();
  });
});

describe("game time", () => {
  function makeTime(initial: number) {
    let worldTime = initial;
    return {
      get worldTime() {
        return worldTime;
      },
      advance: async (s: number) => {
        worldTime += s;
        return worldTime;
      },
    };
  }

  it("advances and sets the world clock", async () => {
    const restore = installFakeGame({ time: makeTime(100) });
    const adv = await handleTimeAdvance({ seconds: 3600 });
    expect(adv).toMatchObject({ worldTime: 3700, advancedBy: 3600 });
    const set = await handleTimeSet({ worldTime: 50 });
    expect(set).toMatchObject({ worldTime: 50, advancedBy: -3650 });
    restore();
  });

  it("returns UNAVAILABLE when game.time is missing", async () => {
    const restore = installFakeGame({});
    await expect(handleTimeAdvance({ seconds: 1 })).rejects.toMatchObject({
      code: ErrorCode.UNAVAILABLE,
    });
    restore();
  });
});

describe("draw_walls", () => {
  it("creates wall segments with c-arrays and door flags on the active scene", async () => {
    const created: Record<string, unknown>[] = [];
    const scene: FakeDoc = {
      _id: "s1",
      id: "s1",
      name: "Map",
      createEmbeddedDocuments: async (_n: string, data: Record<string, unknown>[]) => {
        created.push(...data);
        return data.map((d, i) => ({ _id: `w${i}`, ...d }));
      },
    };
    const restore = installFakeGame({ scenes: [scene], activeSceneId: "s1" });
    const r = await handleWallsDraw({
      segments: [
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 100, door: 1, ds: 0 },
      ],
    });
    expect(r).toMatchObject({ scene: "s1", created: 2 });
    expect(created[0]).toEqual({ c: [0, 0, 100, 0] });
    expect(created[1]).toEqual({ c: [100, 0, 100, 100], door: 1, ds: 0 });
    restore();
  });
});

describe("cards", () => {
  function makeStack(id: string, name: string, calls: string[], size = 0): FakeDoc {
    let count = size;
    return {
      _id: id,
      id,
      name,
      cards: {
        get size() {
          return count;
        },
        contents: [],
      },
      deal: async (to: { id?: string }[], number?: number) => {
        calls.push(`deal:${id}->${to.map((t) => t.id).join(",")}x${number}`);
        return undefined;
      },
      draw: async (from: { id?: string }, number?: number) => {
        calls.push(`draw:${id}<-${from.id}x${number}`);
        count += number ?? 1;
        return Array.from({ length: number ?? 1 }, (_, i) => ({ id: `c${i}`, name: `Card ${i}` }));
      },
      shuffle: async () => {
        calls.push(`shuffle:${id}`);
        return undefined;
      },
      pass: async (to: { id?: string }, ids: string[]) => {
        calls.push(`pass:${id}->${to.id}:${ids.join(",")}`);
        return ids.map((cid) => ({ id: cid, name: cid }));
      },
      reset: async () => {
        calls.push(`reset:${id}`);
        return undefined;
      },
    };
  }

  it("deals, draws, shuffles, passes and resets", async () => {
    const calls: string[] = [];
    const deck = makeStack("deck", "Deck", calls, 52);
    const hand = makeStack("hand", "Hand", calls);
    const restore = installFakeGame({ cards: [deck, hand] });

    await handleCardsDeal({ deck: { _id: "deck" }, to: [{ _id: "hand" }], number: 2 });
    const drew = await handleCardsDraw({ to: { _id: "hand" }, from: { _id: "deck" }, number: 3 });
    expect(drew.drawn).toHaveLength(3);
    await handleCardsShuffle({ deck: { _id: "deck" } });
    await handleCardsPass({ from: { _id: "hand" }, to: { _id: "deck" }, cards: ["c1"] });
    await handleCardsReset({ deck: { _id: "deck" } });

    expect(calls).toEqual([
      "deal:deck->handx2",
      "draw:hand<-deckx3",
      "shuffle:deck",
      "pass:hand->deck:c1",
      "reset:deck",
    ]);
    restore();
  });

  it("returns NOT_FOUND for a missing stack", async () => {
    const restore = installFakeGame({ cards: [] });
    await expect(handleCardsShuffle({ deck: { _id: "nope" } })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    restore();
  });

  it("returns UNAVAILABLE when the stack lacks the method", async () => {
    const restore = installFakeGame({ cards: [{ _id: "d", name: "Plain" }] });
    await expect(handleCardsShuffle({ deck: { _id: "d" } })).rejects.toMatchObject({
      code: ErrorCode.UNAVAILABLE,
    });
    restore();
  });
});

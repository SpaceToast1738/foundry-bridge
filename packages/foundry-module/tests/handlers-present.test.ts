import {
  handlePresentPing,
  handlePresentPull,
  handlePresentShow,
} from "../src/handlers/present";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

describe("present handlers", () => {
  let restore: () => void;
  let shared: string[];
  let pinged: { x: number; y: number } | null;
  let emits: unknown[][];

  beforeEach(() => {
    shared = [];
    pinged = null;
    emits = [];
    const journal: FakeDoc = { _id: "j1", id: "j1", name: "Handout", show: async () => "shown" };
    restore = installFakeGame({ journal: [journal], scenes: [{ _id: "s1", id: "s1", name: "Map" } as never] });
    (globalThis as Record<string, unknown>).ImagePopout = class {
      constructor(public src: string) {}
      shareImage() { shared.push(this.src); }
    };
    (globalThis as Record<string, unknown>).canvas = { ping: (p: { x: number; y: number }) => { pinged = p; } };
    ((globalThis as Record<string, unknown>).game as { socket?: unknown }).socket = {
      emit: (...a: unknown[]) => emits.push(a),
    };
  });
  afterEach(() => {
    restore();
    delete (globalThis as Record<string, unknown>).ImagePopout;
    delete (globalThis as Record<string, unknown>).canvas;
  });

  it("shares an image to players", async () => {
    const r = await handlePresentShow({ image: "art/handout.png", title: "Map" });
    expect(r).toMatchObject({ shown: "image" });
    expect(shared).toEqual(["art/handout.png"]);
  });

  it("shows a journal to players", async () => {
    const r = await handlePresentShow({ journal: { _id: "j1" } });
    expect(r).toMatchObject({ shown: "journal", journal: "j1" });
  });

  it("pulls players to a scene via socket", () => {
    const r = handlePresentPull({ scene: { _id: "s1" } });
    expect(r).toMatchObject({ pulled: true, scene: "s1" });
    expect(emits[0]).toEqual(["pullToScene", "s1"]);
  });

  it("pings a location on the canvas", () => {
    const r = handlePresentPing({ x: 120, y: 240 });
    expect(r).toMatchObject({ pinged: { x: 120, y: 240 } });
    expect(pinged).toEqual({ x: 120, y: 240 });
  });
});

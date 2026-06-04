import { ErrorCode } from "@foundry-bridge/shared";
import {
  handleDoorToggle,
  handleLightPlace,
  handleNotePlace,
  handleSceneCreate,
} from "../src/handlers/scenes";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

describe("create_scene", () => {
  it("creates a placeable-ready scene with default grid/dimensions", async () => {
    let activated = false;
    const restore = installFakeGame({
      // Provide a Scene class via skipDocumentClasses=false default; capture create data.
    });
    // Override the global Scene class to capture the data + return a scene doc.
    let captured: Record<string, unknown> | undefined;
    (globalThis as Record<string, unknown>).Scene = {
      createDocuments: async (data: Record<string, unknown>[]) => {
        captured = data[0];
        return [
          {
            id: "s-new",
            name: data[0].name,
            width: data[0].width,
            height: data[0].height,
            activate: async () => {
              activated = true;
            },
          } as FakeDoc,
        ];
      },
      updateDocuments: async () => [],
      deleteDocuments: async () => [],
    };
    const r = await handleSceneCreate({ name: "Cavern", activate: true });
    expect(captured).toMatchObject({
      name: "Cavern",
      width: 4000,
      height: 3000,
      grid: { type: 1, size: 100 },
    });
    expect(r).toMatchObject({ _id: "s-new", name: "Cavern" });
    expect(activated).toBe(true);
    restore();
  });
});

describe("toggle_door", () => {
  function sceneWithWall(ds: number, calls: Record<string, unknown>[]): FakeDoc {
    return {
      _id: "s1",
      id: "s1",
      name: "Map",
      walls: { get: (_id: string) => ({ ds }) },
      updateEmbeddedDocuments: async (_n: string, updates: Record<string, unknown>[]) => {
        calls.push(...updates);
        return updates;
      },
    } as unknown as FakeDoc;
  }

  it("flips a closed door open when state omitted", async () => {
    const calls: Record<string, unknown>[] = [];
    const restore = installFakeGame({ scenes: [sceneWithWall(0, calls)], activeSceneId: "s1" });
    const r = await handleDoorToggle({ wall_id: "w1" });
    expect(r).toMatchObject({ wall: "w1", ds: 1 });
    expect(calls[0]).toEqual({ _id: "w1", ds: 1 });
    restore();
  });

  it("sets an explicit state", async () => {
    const calls: Record<string, unknown>[] = [];
    const restore = installFakeGame({ scenes: [sceneWithWall(1, calls)], activeSceneId: "s1" });
    const r = await handleDoorToggle({ wall_id: "w1", state: 2 });
    expect(r).toMatchObject({ ds: 2 });
    restore();
  });
});

describe("place_light / place_note", () => {
  function makeScene(created: { kind: string; data: Record<string, unknown> }[]): FakeDoc {
    return {
      _id: "s1",
      id: "s1",
      name: "Map",
      createEmbeddedDocuments: async (kind: string, data: Record<string, unknown>[]) => {
        created.push({ kind, data: data[0] });
        return data.map((d, i) => ({ _id: `e${i}`, ...d }));
      },
    } as unknown as FakeDoc;
  }

  it("places a light with a config block", async () => {
    const created: { kind: string; data: Record<string, unknown> }[] = [];
    const restore = installFakeGame({ scenes: [makeScene(created)], activeSceneId: "s1" });
    await handleLightPlace({ x: 100, y: 200, dim: 30, bright: 10, color: "#ffaa33" });
    expect(created[0]).toMatchObject({
      kind: "AmbientLight",
      data: { x: 100, y: 200, config: { dim: 30, bright: 10, color: "#ffaa33" } },
    });
    restore();
  });

  it("places a note linked to a journal", async () => {
    const created: { kind: string; data: Record<string, unknown> }[] = [];
    const restore = installFakeGame({
      scenes: [makeScene(created)],
      activeSceneId: "s1",
      journal: [{ _id: "j1", name: "Inn" }],
    });
    await handleNotePlace({ x: 50, y: 60, journal: { _id: "j1" }, text: "The Inn" });
    expect(created[0]).toMatchObject({
      kind: "Note",
      data: { x: 50, y: 60, entryId: "j1", text: "The Inn" },
    });
    restore();
  });

  it("returns NOT_FOUND when the journal ref misses", async () => {
    const created: { kind: string; data: Record<string, unknown> }[] = [];
    const restore = installFakeGame({ scenes: [makeScene(created)], activeSceneId: "s1", journal: [] });
    await expect(
      handleNotePlace({ x: 1, y: 2, journal: { _id: "nope" } }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    restore();
  });
});

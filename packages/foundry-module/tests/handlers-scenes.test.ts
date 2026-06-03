import {
  handleSceneActivate,
  handleSceneActive,
  handleTokenPlace,
  handleTokenUpdate,
} from "../src/handlers/scenes";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

function makeScene(id: string, name: string): FakeDoc {
  const tokens: Record<string, unknown>[] = [];
  return {
    _id: id,
    id,
    name,
    width: 4000,
    height: 3000,
    tokens: { get size() { return tokens.length; }, contents: tokens },
    activate: async () => undefined,
    createEmbeddedDocuments: async (_n: string, data: Record<string, unknown>[]) => {
      const created = data.map((d, i) => ({ _id: `tok${i}`, ...d }));
      tokens.push(...created);
      return created;
    },
    updateEmbeddedDocuments: async (_n: string, updates: Record<string, unknown>[]) => {
      const out: Record<string, unknown>[] = [];
      for (const u of updates) {
        const t = tokens.find((x) => x._id === u._id);
        if (t) {
          Object.assign(t, u);
          out.push(t);
        }
      }
      return out;
    },
  };
}

function makeActor(): FakeDoc {
  return {
    _id: "a1",
    name: "Goblin",
    getTokenDocument: async (data: Record<string, unknown>) => ({
      toObject: () => ({ name: "Goblin", actorId: "a1", ...data }),
    }),
  };
}

describe("scene & token handlers", () => {
  let restore: () => void;
  beforeEach(() => {
    const scene = makeScene("s1", "Hollowford");
    restore = installFakeGame({ scenes: [scene], actors: [makeActor()], activeSceneId: "s1" });
    // seed a token to update
    (scene as { tokens: { contents: Record<string, unknown>[] } }).tokens.contents.push({
      _id: "t9",
      x: 0,
      y: 0,
    });
  });
  afterEach(() => restore());

  it("reports the active scene", () => {
    const res = handleSceneActive();
    expect(res).toMatchObject({ _id: "s1", name: "Hollowford", active: true });
  });

  it("activates a scene by ref", async () => {
    const res = await handleSceneActivate({ ref: { _id: "s1" } });
    expect(res).toMatchObject({ _id: "s1", active: true });
  });

  it("places a token from an actor on the active scene", async () => {
    const res = await handleTokenPlace({ actor: { name: "Goblin" }, x: 100, y: 200 });
    expect(res).toMatchObject({ name: "Goblin", x: 100, y: 200, actorId: "a1" });
  });

  it("updates a token by id", async () => {
    const res = await handleTokenUpdate({ token_id: "t9", updates: { x: 500, y: 600 } });
    expect(res).toMatchObject({ _id: "t9", x: 500, y: 600 });
  });

  it("NOT_FOUND placing for an unknown actor", async () => {
    await expect(
      handleTokenPlace({ actor: { name: "Ghost" }, x: 1, y: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

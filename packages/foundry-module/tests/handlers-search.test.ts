import { handleDocumentsSearch } from "../src/handlers/search";
import { installFakeGame } from "./helpers/fake-game";

describe("handleDocumentsSearch", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = installFakeGame({
      actors: [
        { _id: "a1", name: "Goblin Scout", type: "npc" },
        { _id: "a2", name: "Town Guard", type: "character" },
      ],
      items: [
        { _id: "i1", name: "Fireball", type: "spell", system: { description: { value: "<p>A bright streak flashes toward a point you choose</p>" } } },
        { _id: "i2", name: "Longsword", type: "weapon" },
      ],
      journal: [
        {
          _id: "j1",
          name: "Hollowford Gazetteer",
          pages: [
            { name: "Places", text: { content: "<p>The <strong>Kettle &amp; Crown</strong> inn.</p>" } },
          ],
        },
        { _id: "j2", name: "Quest Board" },
      ],
      tables: [{ _id: "t1", name: "Random Encounters" }],
    });
  });

  afterEach(() => restore());

  it("matches by name across collections", () => {
    const res = handleDocumentsSearch({ query: "goblin" });
    expect(res.count).toBe(1);
    expect(res.results[0]).toMatchObject({ collection: "actors", _id: "a1" });
  });

  it("matches journal page text and returns a snippet", () => {
    const res = handleDocumentsSearch({ query: "kettle" });
    expect(res.count).toBe(1);
    expect(res.results[0].collection).toBe("journal");
    expect(res.results[0].snippet).toMatch(/Kettle & Crown/);
  });

  it("can restrict to specific collections", () => {
    const res = handleDocumentsSearch({ query: "a", collections: ["tables"] });
    expect(res.results.every((r) => r.collection === "tables")).toBe(true);
  });

  it("skips journal text when include_text is false", () => {
    const res = handleDocumentsSearch({ query: "kettle", include_text: false });
    expect(res.count).toBe(0);
  });

  it("honours the limit", () => {
    const res = handleDocumentsSearch({ query: "o", limit: 1 });
    expect(res.results.length).toBe(1);
  });

  it("rejects an unknown collection", () => {
    expect(() => handleDocumentsSearch({ query: "x", collections: ["nope"] })).toThrow();
  });

  it("filters by document type", () => {
    const res = handleDocumentsSearch({ query: "o", collections: ["actors"], type: "npc" });
    expect(res.results.every((r) => r._id === "a1")).toBe(true);
    expect(res.count).toBe(1);
  });

  it("matches inside match_fields and returns a field snippet", () => {
    const res = handleDocumentsSearch({
      query: "bright streak",
      collections: ["items"],
      match_fields: ["system.description.value"],
    });
    expect(res.count).toBe(1);
    expect(res.results[0]._id).toBe("i1");
    expect(res.results[0].snippet).toMatch(/system\.description\.value: .*bright streak/);
  });
});

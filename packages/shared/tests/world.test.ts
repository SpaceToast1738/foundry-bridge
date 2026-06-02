import { filterWorldData } from "../src/world";

describe("filterWorldData", () => {
  it("removes the listed keys", () => {
    const result = filterWorldData(
      { title: "World", actors: [], items: [], system: { id: "dnd5e" } },
      ["actors", "items"],
    );
    expect(result).toEqual({ title: "World", system: { id: "dnd5e" } });
  });

  it("returns a shallow copy when nothing is excluded", () => {
    const input = { a: 1, b: 2 };
    const out = filterWorldData(input, []);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});

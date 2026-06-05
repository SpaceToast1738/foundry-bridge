import { buildUpdateEntry } from "../src/handlers/update-utils";

describe("buildUpdateEntry (unset → Foundry -= keys)", () => {
  it("passes data through and translates unset paths to deletion keys", () => {
    const out = buildUpdateEntry({
      name: "Renamed",
      unset: ["ownership.AJ88q6JHSJsGFF9E", "flags.myModule.temp", "topLevel"],
    });
    expect(out).toEqual({
      name: "Renamed",
      "ownership.-=AJ88q6JHSJsGFF9E": null,
      "flags.myModule.-=temp": null,
      "-=topLevel": null,
    });
    expect(out).not.toHaveProperty("unset");
  });

  it("is a no-op when unset is absent", () => {
    expect(buildUpdateEntry({ name: "x" })).toEqual({ name: "x" });
  });

  it("refuses protected and empty paths", () => {
    expect(() => buildUpdateEntry({ unset: ["_id"] })).toThrow(/protected/);
    expect(() => buildUpdateEntry({ unset: ["_stats.foo"] })).toThrow(/protected/);
    expect(() => buildUpdateEntry({ unset: [""] })).toThrow(/protected|empty/);
  });

  it("rejects a non-string-array unset", () => {
    expect(() => buildUpdateEntry({ unset: "flags.foo" as unknown as string[] })).toThrow(
      /must be an array/,
    );
  });
});

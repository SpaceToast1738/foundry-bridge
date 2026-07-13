import { handleWorldGet } from "../src/handlers/world";
import { handleGamePause } from "../src/handlers/game";
import { installFakeGame } from "./helpers/fake-game";

describe("handleWorldGet", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("returns world metadata and per-collection counts", () => {
    uninstall = installFakeGame({
      world: { id: "shattered-orrery", title: "The Shattered Orrery" },
      system: { id: "dnd5e", version: "3.0.0" },
      version: "14.363",
      actors: [
        { _id: "a1", name: "Aragorn" },
        { _id: "a2", name: "Gandalf" },
      ],
      items: [{ _id: "i1", name: "Sting" }],
      journal: [{ _id: "j1", name: "Session 1" }],
    });

    const out = handleWorldGet();
    expect(out.title).toBe("The Shattered Orrery");
    expect(out.id).toBe("shattered-orrery");
    expect(out.foundryVersion).toBe("14.363");
    expect(out.system).toEqual({ id: "dnd5e", version: "3.0.0" });
    expect(out.counts).toEqual({
      users: 0,
      actors: 2,
      items: 1,
      journal: 1,
      folders: 0,
      scenes: 0,
    });
  });

  it("handles a sparsely populated game object", () => {
    uninstall = installFakeGame({});
    const out = handleWorldGet();
    expect(out.title).toBeUndefined();
    expect(out.counts.actors).toBe(0);
  });

  it("reports the paused state (default false)", () => {
    uninstall = installFakeGame({});
    expect(handleWorldGet().paused).toBe(false);
    uninstall();
    uninstall = installFakeGame({ paused: true });
    expect(handleWorldGet().paused).toBe(true);
  });
});

describe("handleGamePause", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("sets, clears, and toggles the pause state", () => {
    uninstall = installFakeGame({ paused: false });
    expect(handleGamePause({ paused: true })).toEqual({ paused: true });
    expect(handleWorldGet().paused).toBe(true);
    expect(handleGamePause({ paused: false })).toEqual({ paused: false });
    // No argument toggles.
    expect(handleGamePause(undefined)).toEqual({ paused: true });
    expect(handleGamePause({})).toEqual({ paused: false });
  });
});

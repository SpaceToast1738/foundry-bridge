import {
  handleModuleGet,
  handleModulesList,
  handleSettingGet,
  handleSettingSet,
  handleSettingsList,
} from "../src/handlers/config";
import { installFakeGame } from "./helpers/fake-game";

describe("config handlers (modules + settings)", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFakeGame({
      modules: {
        "foundry-bridge": {
          title: "Foundry Bridge",
          version: "0.2.0",
          active: true,
          compatibility: { minimum: "13", verified: "14" },
          authors: [{ name: "Spencer" }],
        },
        "dice-so-nice": {
          title: "Dice So Nice!",
          version: "5.0.0",
          active: false,
          relationships: { requires: [{ id: "lib-wrapper" }] },
        },
      },
      settings: { time: true },
      settingDefs: [
        {
          namespace: "core",
          key: "time",
          name: "Game Time",
          scope: "world",
          config: false,
          type: Boolean,
          default: false,
        },
        {
          namespace: "dnd5e",
          key: "diagonalMovement",
          name: "Diagonal Movement Rule",
          scope: "world",
          config: true,
          type: String,
          default: "555",
          choices: { "555": "Standard", "5105": "Variant" },
        },
      ],
    });
  });
  afterEach(() => restore());

  it("lists modules with details, sorted by id", () => {
    const res = handleModulesList(undefined) as {
      count: number;
      modules: Array<Record<string, unknown>>;
    };
    expect(res.count).toBe(2);
    expect(res.modules[0].id).toBe("dice-so-nice");
    expect(res.modules[1]).toMatchObject({
      id: "foundry-bridge",
      title: "Foundry Bridge",
      version: "0.2.0",
      active: true,
      authors: ["Spencer"],
    });
    expect(res.modules[0]).toMatchObject({
      active: false,
      requires: ["lib-wrapper"],
    });
  });

  it("filters modules by active state", () => {
    const res = handleModulesList({ active: true }) as { modules: unknown[] };
    expect(res.modules).toHaveLength(1);
    expect((res.modules[0] as { id: string }).id).toBe("foundry-bridge");
  });

  it("gets one module by id, including description-less detail", () => {
    const res = handleModuleGet({ id: "dice-so-nice" }) as Record<string, unknown>;
    expect(res).toMatchObject({ id: "dice-so-nice", active: false });
  });

  it("NOT_FOUND for an unknown module id", () => {
    expect(() => handleModuleGet({ id: "nope" })).toThrow(/No module/);
  });

  it("lists registered settings, optionally filtered by namespace", () => {
    const all = handleSettingsList(undefined) as { count: number };
    expect(all.count).toBe(2);
    const dnd = handleSettingsList({ namespace: "dnd5e" }) as {
      settings: Array<Record<string, unknown>>;
    };
    expect(dnd.settings).toHaveLength(1);
    expect(dnd.settings[0]).toMatchObject({
      namespace: "dnd5e",
      key: "diagonalMovement",
      type: "String",
      choices: { "555": "Standard", "5105": "Variant" },
    });
  });

  it("includes current values when requested", () => {
    const res = handleSettingsList({ namespace: "core", include_values: true }) as {
      settings: Array<Record<string, unknown>>;
    };
    expect(res.settings[0]).toMatchObject({ namespace: "core", key: "time", value: true });
  });

  it("gets a single setting value", () => {
    const res = handleSettingGet({ namespace: "core", key: "time" });
    expect(res).toMatchObject({ namespace: "core", key: "time", value: true });
  });

  it("NOT_FOUND when reading an unregistered setting", () => {
    expect(() => handleSettingGet({ namespace: "core", key: "ghost" })).toThrow(
      /not registered/,
    );
  });

  it("sets a registered setting and echoes the stored value", async () => {
    const res = await handleSettingSet({
      namespace: "dnd5e",
      key: "diagonalMovement",
      value: "5105",
    });
    expect(res).toMatchObject({
      namespace: "dnd5e",
      key: "diagonalMovement",
      value: "5105",
    });
    // confirm it persisted via get
    const got = handleSettingGet({ namespace: "dnd5e", key: "diagonalMovement" });
    expect((got as { value: unknown }).value).toBe("5105");
  });

  it("NOT_FOUND when setting an unregistered key", async () => {
    await expect(
      handleSettingSet({ namespace: "core", key: "ghost", value: 1 }),
    ).rejects.toThrow(/not registered/);
  });
});

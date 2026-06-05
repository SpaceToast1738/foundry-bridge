import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Method } from "@foundry-bridge/shared";
import { buildToolDefinitions, dispatchTool, type ToolContext } from "../src/tools";
import type { Relay } from "../src/relay";

interface RelayCall {
  method: string;
  params: unknown;
}

function makeRelay(): { relay: Relay; calls: RelayCall[] } {
  const calls: RelayCall[] = [];
  const relay = {
    call: jest.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { ok: true };
    }),
  } as unknown as Relay;
  return { relay, calls };
}

function ctxWith(relay: Relay): ToolContext {
  return {
    relay,
    credentials: [
      { _id: "alpha", hostname: "a", userid: "u", password: "p" },
    ],
    activeIndex: 0,
  };
}

describe("buildToolDefinitions", () => {
  it("includes the v1 surface", () => {
    const tools = buildToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_world",
        "ping",
        "get_actors",
        "get_actor",
        "get_items",
        "get_item",
        "get_journals",
        "get_journal",
        "get_folders",
        "get_folder",
        "get_scenes",
        "get_scene",
        "get_users",
        "get_user",
        "create_document",
        "modify_document",
        "delete_document",
        "create_folder",
        "move_to_folder",
        "show_credentials",
      ]),
    );
  });

  it("does not expose out-of-scope tools", () => {
    const tools = buildToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("upload_file"); // we use upload_image
    expect(names).not.toContain("choose_foundry_instance");
  });

  it("annotates heavy single-gets with a larger result-size ceiling", () => {
    const tools = buildToolDefinitions() as { name: string; _meta?: Record<string, unknown> }[];
    const by = (n: string) => tools.find((t) => t.name === n);
    for (const n of ["get_actor", "get_journal", "get_scene"]) {
      expect(by(n)?._meta).toEqual({ "anthropic/maxResultSizeChars": 200_000 });
    }
    // a light single-get and a list tool carry no annotation
    expect(by("get_item")?._meta).toBeUndefined();
    expect(by("get_actors")?._meta).toBeUndefined();
  });
});

describe("dispatchTool", () => {
  it("get_world calls world.get with empty params", async () => {
    const { relay, calls } = makeRelay();
    await dispatchTool("get_world", {}, ctxWith(relay));
    expect(calls).toEqual([{ method: Method.WORLD_GET, params: {} }]);
  });

  it("ping calls ping with empty params", async () => {
    const { relay, calls } = makeRelay();
    await dispatchTool("ping", {}, ctxWith(relay));
    expect(calls).toEqual([{ method: Method.PING, params: {} }]);
  });

  it("get_actors forwards list params with the collection baked in", async () => {
    const { relay, calls } = makeRelay();
    await dispatchTool(
      "get_actors",
      { where: { type: "npc" }, max_length: 5_000 },
      ctxWith(relay),
    );
    expect(calls).toEqual([
      {
        method: Method.DOCUMENTS_LIST,
        params: {
          collection: "actors",
          where: { type: "npc" },
          max_length: 5_000,
        },
      },
    ]);
  });

  it("get_journal translates id/name flat args into a ref object", async () => {
    const { relay, calls } = makeRelay();
    await dispatchTool(
      "get_journal",
      { _id: "j1", requested_fields: ["pages"] },
      ctxWith(relay),
    );
    expect(calls).toEqual([
      {
        method: Method.DOCUMENTS_GET,
        params: {
          collection: "journal",
          ref: { _id: "j1" },
          requested_fields: ["pages"],
        },
      },
    ]);
  });

  it("create_document, modify_document, delete_document forward directly", async () => {
    const { relay, calls } = makeRelay();
    await dispatchTool(
      "create_document",
      { type: "Item", data: [{ name: "a" }] },
      ctxWith(relay),
    );
    await dispatchTool(
      "modify_document",
      { type: "Actor", _id: "a", updates: [{ name: "b" }] },
      ctxWith(relay),
    );
    await dispatchTool(
      "delete_document",
      { type: "Item", ids: ["i1"] },
      ctxWith(relay),
    );
    expect(calls.map((c) => c.method)).toEqual([
      Method.DOCUMENTS_CREATE,
      Method.DOCUMENTS_UPDATE,
      Method.DOCUMENTS_DELETE,
    ]);
  });

  it("create_folder + move_to_folder forward to folder methods", async () => {
    const { relay, calls } = makeRelay();
    await dispatchTool(
      "create_folder",
      { type: "JournalEntry", name: "Notes" },
      ctxWith(relay),
    );
    await dispatchTool(
      "move_to_folder",
      {
        type: "JournalEntry",
        entity: { _id: "j1" },
        folder: { _id: "f1" },
      },
      ctxWith(relay),
    );
    expect(calls.map((c) => c.method)).toEqual([
      Method.FOLDERS_CREATE,
      Method.FOLDERS_MOVE,
    ]);
  });

  it("show_credentials returns credential info without calling the relay", async () => {
    const { relay, calls } = makeRelay();
    const out = (await dispatchTool("show_credentials", {}, ctxWith(relay))) as {
      _id: string;
      currently_active: boolean;
    }[];
    expect(calls).toEqual([]);
    expect(out[0]._id).toBe("alpha");
    expect(out[0].currently_active).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/password/);
  });

  it("rejects unknown tools with BAD_REQUEST", async () => {
    const { relay } = makeRelay();
    await expect(
      dispatchTool("get_compendium", {}, ctxWith(relay)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("get_status", () => {
  const statusPath = join(tmpdir(), `launcher-status-${process.pid}.json`);
  const prevEnv = process.env.FOUNDRY_BRIDGE_LAUNCHER_STATUS;
  beforeAll(() => {
    process.env.FOUNDRY_BRIDGE_LAUNCHER_STATUS = statusPath;
  });
  afterAll(() => {
    if (prevEnv === undefined) delete process.env.FOUNDRY_BRIDGE_LAUNCHER_STATUS;
    else process.env.FOUNDRY_BRIDGE_LAUNCHER_STATUS = prevEnv;
    try { rmSync(statusPath); } catch { /* ignore */ }
  });

  function ctxWithConn(connected: boolean): ToolContext {
    const relay = {
      isConnected: () => connected,
      call: jest.fn(async () => ({ moduleVersion: "0.2.0", world: { title: "W" } })),
      getStats: () => ({ connectedSince: 1, totalCalls: 3, errorCount: 1, lastError: null }),
      getRecentActivity: () => [{ method: "ping", ok: true, ms: 5, ts: 2 }],
    } as unknown as Relay;
    return { relay, credentials: [], activeIndex: 0, serverVersion: "9.9.9" };
  }

  it("surfaces launcher diagnostics when the module is NOT connected", async () => {
    writeFileSync(statusPath, JSON.stringify({ state: "non_gm", currentWorld: "Driftworlds", isGM: false }));
    const out = (await dispatchTool("get_status", {}, ctxWithConn(false))) as Record<string, unknown>;
    expect(out.relayConnected).toBe(false);
    expect(out.serverVersion).toBe("9.9.9");
    expect(out.launcher).toMatchObject({ state: "non_gm", currentWorld: "Driftworlds", isGM: false });
  });

  it("includes module status AND launcher block when connected", async () => {
    writeFileSync(statusPath, JSON.stringify({ state: "connected", currentWorld: "Driftworlds", isGM: true }));
    const out = (await dispatchTool("get_status", {}, ctxWithConn(true))) as Record<string, unknown>;
    expect(out.relayConnected).toBe(true);
    expect(out.moduleVersion).toBe("0.2.0");
    expect(out.serverVersion).toBe("9.9.9");
    expect(out.relayStats).toMatchObject({ totalCalls: 3, errorCount: 1 });
    expect(out.launcher).toMatchObject({ state: "connected" });
  });

  it("get_recent_activity returns the relay ring buffer (no module round-trip)", async () => {
    const out = (await dispatchTool("get_recent_activity", {}, ctxWithConn(false))) as Record<string, unknown>;
    expect(out.activity).toEqual([{ method: "ping", ok: true, ms: 5, ts: 2 }]);
  });

  it("returns state:unknown when no status file exists", async () => {
    try { rmSync(statusPath); } catch { /* ignore */ }
    const out = (await dispatchTool("get_status", {}, ctxWithConn(false))) as Record<string, unknown>;
    expect(out.launcher).toMatchObject({ state: "unknown" });
  });
});

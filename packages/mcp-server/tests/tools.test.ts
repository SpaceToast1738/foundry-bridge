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

  it("does not expose v1-out-of-scope tools", () => {
    const tools = buildToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("upload_file");
    expect(names).not.toContain("create_compendium");
    expect(names).not.toContain("choose_foundry_instance");
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

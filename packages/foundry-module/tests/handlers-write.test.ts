import { ErrorCode, Method } from "@foundry-bridge/shared";
import {
  handleDocumentsCreate,
  handleDocumentsDelete,
  handleDocumentsUpdate,
} from "../src/handlers/documents";
import { dispatch } from "../src/dispatch";
import type { PermissionState } from "../src/permissions";
import { installFakeGame } from "./helpers/fake-game";

function gmState(overrides: Partial<PermissionState> = {}): PermissionState {
  return {
    isGM: true,
    writeEnabled: true,
    destructiveEnabled: true,
    maxDeletePerCall: 5,
    ...overrides,
  };
}

describe("handleDocumentsCreate", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("creates documents via the document class static", async () => {
    uninstall = installFakeGame({});
    const out = await handleDocumentsCreate({
      type: "Actor",
      data: [{ name: "Boromir" }, { name: "Faramir" }],
    });
    expect(out.type).toBe("Actor");
    expect(out.count).toBe(2);
    expect(out.documents.map((d) => d.name)).toEqual(["Boromir", "Faramir"]);
  });

  it("rejects unknown document types with BAD_REQUEST", async () => {
    uninstall = installFakeGame({});
    await expect(
      handleDocumentsCreate({ type: "Banana", data: [{ name: "x" }] }),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it("rejects when the document class is not loaded", async () => {
    uninstall = installFakeGame({ skipDocumentClasses: true });
    await expect(
      handleDocumentsCreate({ type: "Actor", data: [{ name: "x" }] }),
    ).rejects.toMatchObject({ code: ErrorCode.UNAVAILABLE });
  });
});

describe("handleDocumentsUpdate", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("applies each update in order and returns the final doc", async () => {
    uninstall = installFakeGame({
      actors: [{ _id: "a1", name: "old", level: 1 }],
    });
    const out = await handleDocumentsUpdate({
      type: "Actor",
      _id: "a1",
      updates: [{ name: "new" }, { level: 5 }],
    });
    expect(out).toMatchObject({ _id: "a1", name: "new", level: 5 });
  });

  it("returns NOT_FOUND when the target document does not exist", async () => {
    uninstall = installFakeGame({});
    await expect(
      handleDocumentsUpdate({
        type: "Actor",
        _id: "ghost",
        updates: [{ name: "x" }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("translates unset paths into Foundry deletion keys on the update", async () => {
    const captured: Record<string, unknown>[] = [];
    uninstall = installFakeGame({ actors: [{ _id: "a1", name: "x" }] });
    // Wrap the document class to capture what reaches updateDocuments.
    const cls = (globalThis as Record<string, unknown>).Actor as {
      updateDocuments: (u: Record<string, unknown>[]) => Promise<unknown[]>;
    };
    const orig = cls.updateDocuments;
    cls.updateDocuments = async (u) => {
      captured.push(...u);
      return orig(u);
    };
    await handleDocumentsUpdate({
      type: "Actor",
      _id: "a1",
      updates: [{ name: "y", unset: ["flags.foo"] }],
    });
    expect(captured[0]).toMatchObject({ _id: "a1", name: "y", "flags.-=foo": null });
  });

  it("dry_run update returns a preview and does NOT persist", async () => {
    uninstall = installFakeGame({ actors: [{ _id: "a1", name: "old" }] });
    const out = await handleDocumentsUpdate({
      type: "Actor",
      _id: "a1",
      updates: [{ name: "new" }],
      dry_run: true,
    });
    expect(out).toMatchObject({ dry_run: true, _id: "a1" });
    // unchanged
    const actor = (globalThis as { game: { actors: { get(id: string): { name?: string } } } }).game
      .actors.get("a1");
    expect(actor?.name).toBe("old");
  });
});

describe("handleDocumentsDelete", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("deletes by id and returns the deleted ids", async () => {
    uninstall = installFakeGame({
      items: [
        { _id: "i1", name: "a" },
        { _id: "i2", name: "b" },
        { _id: "i3", name: "c" },
      ],
    });
    const out = await handleDocumentsDelete(
      { type: "Item", ids: ["i1", "i3"] },
      gmState(),
    );
    expect(out.count).toBe(2);
    expect(out.ids).toEqual(["i1", "i3"]);
  });

  it("enforces the configured bulk limit", async () => {
    uninstall = installFakeGame({
      items: Array.from({ length: 10 }, (_, i) => ({ _id: `i${i}`, name: "x" })),
    });
    await expect(
      handleDocumentsDelete(
        { type: "Item", ids: ["i0", "i1", "i2", "i3", "i4", "i5"] },
        gmState({ maxDeletePerCall: 5 }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("returns silently if the id does not exist", async () => {
    uninstall = installFakeGame({ items: [{ _id: "i1", name: "a" }] });
    const out = await handleDocumentsDelete(
      { type: "Item", ids: ["ghost"] },
      gmState(),
    );
    expect(out.count).toBe(0);
    expect(out.ids).toEqual([]);
  });

  it("dry_run delete lists targets and does NOT delete (and skips the bulk limit)", async () => {
    uninstall = installFakeGame({
      items: Array.from({ length: 8 }, (_, i) => ({ _id: `i${i}`, name: `n${i}`, type: "loot" })),
    });
    const out = (await handleDocumentsDelete(
      { type: "Item", ids: ["i0", "i1", "i2", "i3", "i4", "i5", "i6"], dry_run: true },
      gmState({ maxDeletePerCall: 2 }), // would normally FORBIDDEN; dry_run skips it
    )) as { dry_run: boolean; would_delete: { _id: string; name: unknown }[] };
    expect(out.dry_run).toBe(true);
    expect(out.would_delete).toHaveLength(7);
    expect(out.would_delete[0]).toMatchObject({ _id: "i0", name: "n0", type: "loot" });
    // nothing deleted
    const items = (globalThis as { game: { items: { contents: unknown[] } } }).game.items.contents;
    expect(items).toHaveLength(8);
  });

  it("dry_run create returns would_create and does NOT persist", async () => {
    uninstall = installFakeGame({});
    const out = (await handleDocumentsCreate({
      type: "Actor",
      data: [{ name: "Preview" }],
      dry_run: true,
    })) as { dry_run: boolean; would_create: unknown[] };
    expect(out.dry_run).toBe(true);
    expect(out.would_create).toEqual([{ name: "Preview" }]);
    const actors = (globalThis as { game: { actors: { contents: unknown[] } } }).game.actors.contents;
    expect(actors).toHaveLength(0);
  });
});

describe("dispatch integration with write tier", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("blocks create when write tier is disabled", async () => {
    uninstall = installFakeGame({});
    await expect(
      dispatch(
        Method.DOCUMENTS_CREATE,
        { type: "Actor", data: [{ name: "x" }] },
        gmState({ writeEnabled: false }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("blocks delete when destructive tier is disabled", async () => {
    uninstall = installFakeGame({ items: [{ _id: "i1", name: "a" }] });
    await expect(
      dispatch(
        Method.DOCUMENTS_DELETE,
        { type: "Item", ids: ["i1"] },
        gmState({ destructiveEnabled: false }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("plumbs state into delete so bulk limit fires through dispatch", async () => {
    uninstall = installFakeGame({
      items: Array.from({ length: 10 }, (_, i) => ({ _id: `i${i}`, name: "x" })),
    });
    await expect(
      dispatch(
        Method.DOCUMENTS_DELETE,
        { type: "Item", ids: ["i0", "i1", "i2"] },
        gmState({ maxDeletePerCall: 2 }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("forwards a successful create through dispatch", async () => {
    uninstall = installFakeGame({});
    const out = (await dispatch(
      Method.DOCUMENTS_CREATE,
      { type: "Item", data: [{ name: "Healing Potion" }] },
      gmState(),
    )) as { count: number; documents: Record<string, unknown>[] };
    expect(out.count).toBe(1);
    expect(out.documents[0].name).toBe("Healing Potion");
  });
});


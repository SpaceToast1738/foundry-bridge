import { ErrorCode, Method } from "@foundry-bridge/shared";
import {
  handleFoldersCreate,
  handleFoldersMove,
} from "../src/handlers/folders";
import { dispatch } from "../src/dispatch";
import type { PermissionState } from "../src/permissions";
import { installFakeGame } from "./helpers/fake-game";

function gmState(overrides: Partial<PermissionState> = {}): PermissionState {
  return {
    isGM: true,
    writeEnabled: true,
    destructiveEnabled: false,
    maxDeletePerCall: 5,
    ...overrides,
  };
}

describe("handleFoldersCreate", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("creates a top-level folder for journal entries", async () => {
    uninstall = installFakeGame({});
    const out = await handleFoldersCreate({
      type: "JournalEntry",
      name: "Session Notes",
    });
    expect(out).toMatchObject({
      name: "Session Notes",
      type: "JournalEntry",
      folder: null,
    });
  });

  it("creates a nested folder when parent exists", async () => {
    uninstall = installFakeGame({
      folders: [{ _id: "f-parent", name: "Lore", type: "JournalEntry" }],
    });
    const out = await handleFoldersCreate({
      type: "JournalEntry",
      name: "Cities",
      parent: "f-parent",
    });
    expect(out).toMatchObject({ name: "Cities", folder: "f-parent" });
  });

  it("rejects an unknown parent with NOT_FOUND", async () => {
    uninstall = installFakeGame({});
    await expect(
      handleFoldersCreate({
        type: "JournalEntry",
        name: "Orphan",
        parent: "missing",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("rejects an unsupported folder type", async () => {
    uninstall = installFakeGame({});
    await expect(
      handleFoldersCreate({ type: "User", name: "Players" }),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it("rejects when the Folder class is missing", async () => {
    uninstall = installFakeGame({ skipDocumentClasses: true });
    await expect(
      handleFoldersCreate({ type: "JournalEntry", name: "x" }),
    ).rejects.toMatchObject({ code: ErrorCode.UNAVAILABLE });
  });
});

describe("handleFoldersMove", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("moves a journal entry into a folder, looked up by name", async () => {
    uninstall = installFakeGame({
      journal: [{ _id: "j1", name: "Chapter 1", folder: null }],
      folders: [{ _id: "f1", name: "Sessions", type: "JournalEntry" }],
    });
    const out = await handleFoldersMove({
      type: "JournalEntry",
      entity: { _id: "j1" },
      folder: { name: "Sessions" },
    });
    expect(out).toMatchObject({ _id: "j1", folder: "f1" });
  });

  it("moves an entity to the root when folder is null", async () => {
    uninstall = installFakeGame({
      items: [{ _id: "i1", name: "Sword", folder: "f1" }],
      folders: [{ _id: "f1", name: "Weapons", type: "Item" }],
    });
    const out = await handleFoldersMove({
      type: "Item",
      entity: { _id: "i1" },
      folder: null,
    });
    expect(out.folder).toBeNull();
  });

  it("supports nesting folders (moving a Folder into another Folder)", async () => {
    uninstall = installFakeGame({
      folders: [
        { _id: "f-child", name: "City", type: "JournalEntry", folder: null },
        { _id: "f-parent", name: "Lore", type: "JournalEntry", folder: null },
      ],
    });
    const out = await handleFoldersMove({
      type: "Folder",
      entity: { _id: "f-child" },
      folder: { _id: "f-parent" },
    });
    expect(out).toMatchObject({ _id: "f-child", folder: "f-parent" });
  });

  it("returns NOT_FOUND when the entity is missing", async () => {
    uninstall = installFakeGame({
      folders: [{ _id: "f1", name: "x", type: "JournalEntry" }],
    });
    await expect(
      handleFoldersMove({
        type: "JournalEntry",
        entity: { _id: "ghost" },
        folder: { _id: "f1" },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("returns NOT_FOUND when the target folder is missing", async () => {
    uninstall = installFakeGame({
      journal: [{ _id: "j1", name: "x" }],
    });
    await expect(
      handleFoldersMove({
        type: "JournalEntry",
        entity: { _id: "j1" },
        folder: { _id: "ghost" },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("rejects unsupported entity types", async () => {
    uninstall = installFakeGame({});
    await expect(
      handleFoldersMove({
        type: "User",
        entity: { _id: "u1" },
        folder: null,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});

describe("folder filing via dispatch", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("blocks folders.create when write tier is disabled", async () => {
    uninstall = installFakeGame({});
    await expect(
      dispatch(
        Method.FOLDERS_CREATE,
        { type: "JournalEntry", name: "x" },
        gmState({ writeEnabled: false }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("blocks folders.move when write tier is disabled", async () => {
    uninstall = installFakeGame({
      journal: [{ _id: "j1", name: "x" }],
    });
    await expect(
      dispatch(
        Method.FOLDERS_MOVE,
        { type: "JournalEntry", entity: { _id: "j1" }, folder: null },
        gmState({ writeEnabled: false }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("end-to-end: create a folder then move an entry into it", async () => {
    uninstall = installFakeGame({
      journal: [{ _id: "j1", name: "Chapter 1", folder: null }],
    });
    const folder = (await dispatch(
      Method.FOLDERS_CREATE,
      { type: "JournalEntry", name: "Sessions" },
      gmState(),
    )) as { _id: string; name: string };

    const moved = (await dispatch(
      Method.FOLDERS_MOVE,
      {
        type: "JournalEntry",
        entity: { _id: "j1" },
        folder: { _id: folder._id },
      },
      gmState(),
    )) as { folder: string };

    expect(moved.folder).toBe(folder._id);
  });
});

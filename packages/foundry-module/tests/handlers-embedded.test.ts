import {
  handleEmbeddedCreate,
  handleEmbeddedDelete,
  handleEmbeddedUpdate,
} from "../src/handlers/embedded";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";
import type { PermissionState } from "../src/permissions";

const gmState: PermissionState = {
  isGM: true,
  writeEnabled: true,
  destructiveEnabled: true,
  maxDeletePerCall: 5,
};

/** A fake JournalEntry with an embedded `pages` collection + the embedded API. */
function makeJournalWithPages(): FakeDoc {
  const pages: Record<string, unknown>[] = [
    { _id: "p1", name: "Overview", text: { content: "<p>hi</p>" } },
  ];
  return {
    _id: "j1",
    name: "Test Journal",
    pages,
    createEmbeddedDocuments: async (
      _name: string,
      data: Record<string, unknown>[],
    ) => {
      const created = data.map((d, i) => ({ _id: `np${i}`, ...d }));
      pages.push(...created);
      return created;
    },
    updateEmbeddedDocuments: async (
      _name: string,
      updates: Record<string, unknown>[],
    ) => {
      const out: Record<string, unknown>[] = [];
      for (const u of updates) {
        const p = pages.find((x) => x._id === u._id);
        if (p) {
          Object.assign(p, u);
          out.push(p);
        }
      }
      return out;
    },
    deleteEmbeddedDocuments: async (_name: string, ids: string[]) => {
      const removed: Record<string, unknown>[] = [];
      for (const id of ids) {
        const idx = pages.findIndex((x) => x._id === id);
        if (idx >= 0) removed.push(...pages.splice(idx, 1));
      }
      return removed;
    },
  };
}

describe("embedded handlers", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = installFakeGame({ journal: [makeJournalWithPages()] });
  });
  afterEach(() => restore());

  it("creates an embedded page", async () => {
    const res = await handleEmbeddedCreate({
      parent_type: "JournalEntry",
      parent_id: "j1",
      embedded: "JournalEntryPage",
      data: [{ name: "New Page", type: "text" }],
    });
    expect(res.count).toBe(1);
    expect(res.documents[0]).toMatchObject({ name: "New Page" });
  });

  it("updates an embedded page", async () => {
    const res = await handleEmbeddedUpdate({
      parent_type: "JournalEntry",
      parent_id: "j1",
      embedded: "JournalEntryPage",
      updates: [{ _id: "p1", name: "Renamed" }],
    });
    expect(res.documents[0]).toMatchObject({ _id: "p1", name: "Renamed" });
  });

  it("deletes an embedded page and reports ids", async () => {
    const res = await handleEmbeddedDelete(
      {
        parent_type: "JournalEntry",
        parent_id: "j1",
        embedded: "JournalEntryPage",
        ids: ["p1"],
      },
      gmState,
    );
    expect(res.ids).toEqual(["p1"]);
  });

  it("enforces the bulk delete limit", async () => {
    await expect(
      handleEmbeddedDelete(
        {
          parent_type: "JournalEntry",
          parent_id: "j1",
          embedded: "JournalEntryPage",
          ids: ["a", "b", "c", "d", "e", "f"],
        },
        gmState,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("NOT_FOUND for a missing parent", async () => {
    await expect(
      handleEmbeddedCreate({
        parent_type: "JournalEntry",
        parent_id: "nope",
        embedded: "JournalEntryPage",
        data: [{ name: "x" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("BAD_REQUEST for an unknown parent type", async () => {
    await expect(
      handleEmbeddedCreate({
        parent_type: "Bogus",
        parent_id: "j1",
        embedded: "X",
        data: [{ name: "x" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

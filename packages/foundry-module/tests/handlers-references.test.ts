import { handleFindReferences, handleRefreshLabels } from "../src/handlers/references";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

function setup() {
  const pageContent =
    'See @UUID[JournalEntry.t1]{Old Name} and @UUID[JournalEntry.t1]{New Name} and @UUID[Actor.zzz]{Other}.';
  const journalUpdates: Record<string, unknown>[] = [];
  const actorUpdates: Record<string, unknown>[] = [];
  const lore: FakeDoc = {
    _id: "j2",
    name: "Lore",
    pages: [{ _id: "p1", name: "Body", text: { content: pageContent } }],
    updateEmbeddedDocuments: async (_n: string, u: Record<string, unknown>[]) => {
      journalUpdates.push(...u);
      // reflect into the live page so a follow-up read sees it
      for (const upd of u) {
        const pg = (lore.pages as Record<string, unknown>[]).find((p) => p._id === upd._id);
        if (pg) Object.assign(pg, upd);
      }
      return u;
    },
  } as unknown as FakeDoc;
  const npc: FakeDoc = {
    _id: "a1",
    name: "NPC",
    system: { description: { value: "Agent of @UUID[JournalEntry.t1]{Old Name}." } },
    update: async (d: Record<string, unknown>) => {
      actorUpdates.push(d);
      return d;
    },
  } as unknown as FakeDoc;
  const restore = installFakeGame({
    journal: [{ _id: "t1", name: "New Name" }, lore],
    actors: [npc],
  });
  return { restore, journalUpdates, actorUpdates };
}

describe("find_references", () => {
  it("finds links to a target and flags stale labels", () => {
    const { restore } = setup();
    const res = handleFindReferences({ target: "JournalEntry.t1" });
    expect(res.current_name).toBe("New Name");
    // two in the journal page + one in the actor description (link to Actor.zzz excluded)
    expect(res.count).toBe(3);
    const stale = res.references.filter((r) => r.stale);
    expect(stale).toHaveLength(2); // the two "Old Name" labels
    expect(res.references.every((r) => r.link === "@UUID[JournalEntry.t1]")).toBe(true);
    restore();
  });

  it("accepts a bare _id and restricts by collection", () => {
    const { restore } = setup();
    const res = handleFindReferences({ target: "t1", collections: ["actors"] });
    expect(res.count).toBe(1);
    expect(res.references[0]).toMatchObject({ collection: "actors", _id: "a1", stale: true });
    restore();
  });
});

describe("refresh_labels", () => {
  it("dry_run lists stale refs without writing", async () => {
    const { restore, journalUpdates, actorUpdates } = setup();
    const res = await handleRefreshLabels({ target: "JournalEntry.t1", dry_run: true });
    expect(res).toMatchObject({ dry_run: true, current_name: "New Name" });
    expect((res.would_update as unknown[]).length).toBe(2);
    expect(journalUpdates).toHaveLength(0);
    expect(actorUpdates).toHaveLength(0);
    restore();
  });

  it("rewrites stale labels in journal pages and actor descriptions", async () => {
    const { restore, journalUpdates, actorUpdates } = setup();
    const res = await handleRefreshLabels({ target: "JournalEntry.t1" });
    expect(res.current_name).toBe("New Name");
    // journal page rewritten (one page) + actor updated (one)
    expect(journalUpdates).toHaveLength(1);
    expect(String((journalUpdates[0].text as { content: string }).content)).not.toContain("Old Name");
    expect(String((journalUpdates[0].text as { content: string }).content)).toContain(
      "@UUID[JournalEntry.t1]{New Name}",
    );
    expect(actorUpdates[0]["system.description.value"]).toContain("@UUID[JournalEntry.t1]{New Name}");
    restore();
  });

  it("NOT_FOUND when the target does not resolve", async () => {
    const { restore } = setup();
    await expect(handleRefreshLabels({ target: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    restore();
  });
});

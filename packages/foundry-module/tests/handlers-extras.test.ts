import { handleMessagesList } from "../src/handlers/messages";
import { handleDiceRollToChat } from "../src/handlers/dice";
import { handleDocumentsDuplicate } from "../src/handlers/documents";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

describe("get_messages", () => {
  it("returns recent messages with stripped content + alias", () => {
    const restore = installFakeGame({
      messages: [
        { _id: "m1", content: "<p>Hello <b>there</b></p>", speaker: { alias: "GM" }, timestamp: 1 } as never,
        { _id: "m2", content: "second", author: { name: "Alice" }, timestamp: 2 } as never,
      ],
    });
    const res = handleMessagesList({ limit: 5 });
    expect(res.count).toBe(2);
    expect(res.messages[1]).toMatchObject({ _id: "m2", alias: "Alice", content: "second" });
    expect((res.messages[0] as { content: string }).content).toBe("Hello there");
    restore();
  });
});

describe("roll_to_chat", () => {
  it("evaluates and posts a chat card", async () => {
    let posted = false;
    (globalThis as Record<string, unknown>).Roll = class {
      total = 18;
      result = "18";
      constructor(public f: string) {}
      async evaluate() { return this; }
      async toMessage() { posted = true; }
    };
    const restore = installFakeGame({ users: [{ _id: "gm", name: "GM", isGM: true } as never] });
    const res = await handleDiceRollToChat({ formula: "1d20+5", whisper: "gm" });
    expect(res).toMatchObject({ formula: "1d20+5", total: 18, posted: true });
    expect(posted).toBe(true);
    restore();
    delete (globalThis as Record<string, unknown>).Roll;
  });
});

describe("duplicate_document", () => {
  it("clones a document with a new name", async () => {
    const cloned: Record<string, unknown>[] = [];
    const actor: FakeDoc = {
      _id: "a1",
      id: "a1",
      name: "Goblin",
      clone: async (data: Record<string, unknown>, _ctx: Record<string, unknown>) => {
        const copy = { _id: "a2", ...data };
        cloned.push(copy);
        return copy;
      },
    };
    const restore = installFakeGame({ actors: [actor] });
    const res = await handleDocumentsDuplicate({ type: "Actor", ref: { _id: "a1" } });
    expect(res).toMatchObject({ _id: "a2", name: "Goblin (Copy)" });
    restore();
  });
});

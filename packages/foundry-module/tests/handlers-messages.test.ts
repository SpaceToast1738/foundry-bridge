import { handleMessagesCreate } from "../src/handlers/messages";
import { installFakeGame } from "./helpers/fake-game";

interface Captured {
  created: Record<string, unknown>[];
}

function installChatMessage(): Captured {
  const captured: Captured = { created: [] };
  (globalThis as Record<string, unknown>).ChatMessage = {
    create: async (data: Record<string, unknown>) => {
      captured.created.push(data);
      return { _id: "cm1", ...data };
    },
  };
  return captured;
}

describe("handleMessagesCreate", () => {
  let restore: () => void;
  let cap: Captured;

  beforeEach(() => {
    restore = installFakeGame({
      users: [
        { _id: "gm", name: "GM", isGM: true } as never,
        { _id: "u1", name: "Alice", isGM: false } as never,
      ],
    });
    cap = installChatMessage();
  });
  afterEach(() => {
    restore();
    delete (globalThis as Record<string, unknown>).ChatMessage;
  });

  it("posts a public message", async () => {
    await handleMessagesCreate({ content: "Hello table" });
    expect(cap.created[0]).toMatchObject({ content: "Hello table" });
    expect(cap.created[0].whisper).toBeUndefined();
  });

  it("whispers all GMs when whisper is 'gm'", async () => {
    await handleMessagesCreate({ content: "psst", whisper: "gm" });
    expect(cap.created[0].whisper).toEqual(["gm"]);
  });

  it("resolves whisper user refs by name", async () => {
    await handleMessagesCreate({ content: "hi", whisper: [{ name: "Alice" }] });
    expect(cap.created[0].whisper).toEqual(["u1"]);
  });

  it("sets a speaker alias", async () => {
    await handleMessagesCreate({ content: "I am narrator", speaker_alias: "Narrator" });
    expect(cap.created[0].speaker).toEqual({ alias: "Narrator" });
  });

  it("NOT_FOUND for an unknown whisper target", async () => {
    await expect(
      handleMessagesCreate({ content: "x", whisper: [{ name: "Nobody" }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

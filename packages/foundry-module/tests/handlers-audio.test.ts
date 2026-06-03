import {
  handlePlaylistPlay,
  handlePlaylistPlaySound,
  handlePlaylistStop,
} from "../src/handlers/audio";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

function makePlaylist(calls: string[]): FakeDoc {
  const sounds = [{ _id: "s1", id: "s1", name: "Rain" }];
  return {
    _id: "pl1",
    id: "pl1",
    name: "Ambiance",
    sounds: { contents: sounds, get: (id: string) => sounds.find((s) => s.id === id) },
    playAll: async () => { calls.push("playAll"); },
    stopAll: async () => { calls.push("stopAll"); },
    playSound: async (s: { name?: string }) => { calls.push("playSound:" + s.name); },
  };
}

describe("audio handlers", () => {
  let restore: () => void;
  let calls: string[];
  beforeEach(() => {
    calls = [];
    restore = installFakeGame({ playlists: [makePlaylist(calls)] });
  });
  afterEach(() => restore());

  it("plays a playlist", async () => {
    const r = await handlePlaylistPlay({ playlist: { _id: "pl1" } });
    expect(r).toMatchObject({ playlist: "pl1", playing: true });
    expect(calls).toContain("playAll");
  });

  it("stops a playlist", async () => {
    await handlePlaylistStop({ playlist: { name: "Ambiance" } });
    expect(calls).toContain("stopAll");
  });

  it("plays a single sound by name", async () => {
    await handlePlaylistPlaySound({ playlist: { _id: "pl1" }, sound: { name: "Rain" } });
    expect(calls).toContain("playSound:Rain");
  });

  it("NOT_FOUND for an unknown playlist", async () => {
    await expect(handlePlaylistPlay({ playlist: { name: "Nope" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

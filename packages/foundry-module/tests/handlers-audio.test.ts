import {
  handlePlaylistNext,
  handlePlaylistPause,
  handlePlaylistPlay,
  handlePlaylistPlaySound,
  handlePlaylistResume,
  handlePlaylistStop,
  handlePlaylistStopSound,
} from "../src/handlers/audio";
import { installFakeGame, type FakeDoc } from "./helpers/fake-game";

interface SoundStub {
  _id: string;
  id: string;
  name: string;
  playing?: boolean;
  pausedTime?: number | null;
  sound?: { currentTime?: number };
  update?: (d: Record<string, unknown>) => Promise<unknown>;
}

function makePlaylist(calls: string[], updates: Record<string, unknown>[]): FakeDoc {
  const sounds: SoundStub[] = [
    {
      _id: "s1",
      id: "s1",
      name: "Rain",
      playing: true,
      pausedTime: null,
      sound: { currentTime: 12 },
      update: async (d) => {
        updates.push({ sound: "Rain", ...d });
        return d;
      },
    },
    {
      _id: "s2",
      id: "s2",
      name: "Wind",
      playing: false,
      pausedTime: 5,
      sound: { currentTime: 0 },
      update: async (d) => {
        updates.push({ sound: "Wind", ...d });
        return d;
      },
    },
  ];
  return {
    _id: "pl1",
    id: "pl1",
    name: "Ambiance",
    sounds: { contents: sounds, get: (id: string) => sounds.find((s) => s.id === id) },
    playAll: async () => { calls.push("playAll"); },
    stopAll: async () => { calls.push("stopAll"); },
    playSound: async (s: { name?: string }) => { calls.push("playSound:" + s.name); },
    playNext: async (_id: string | null, opts?: { direction?: number }) => {
      calls.push("playNext:" + (opts?.direction ?? 1));
    },
    stopSound: async (s: { name?: string }) => { calls.push("stopSound:" + s.name); },
  };
}

describe("audio handlers", () => {
  let restore: () => void;
  let calls: string[];
  let updates: Record<string, unknown>[];
  beforeEach(() => {
    calls = [];
    updates = [];
    restore = installFakeGame({ playlists: [makePlaylist(calls, updates)] });
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

  it("advances to the next (or previous) track", async () => {
    await handlePlaylistNext({ playlist: { _id: "pl1" } });
    expect(calls).toContain("playNext:1");
    await handlePlaylistNext({ playlist: { _id: "pl1" }, direction: -1 });
    expect(calls).toContain("playNext:-1");
  });

  it("stops a single sound", async () => {
    const r = await handlePlaylistStopSound({ playlist: { _id: "pl1" }, sound: { name: "Rain" } });
    expect(r).toMatchObject({ sound: "s1", playing: false });
    expect(calls).toContain("stopSound:Rain");
  });

  it("pauses a sound, capturing its playback offset", async () => {
    await handlePlaylistPause({ playlist: { _id: "pl1" }, sound: { name: "Rain" } });
    expect(updates).toContainEqual({ sound: "Rain", playing: false, pausedTime: 12 });
  });

  it("pauses everything currently playing when no sound is given", async () => {
    const r = (await handlePlaylistPause({ playlist: { _id: "pl1" } })) as { paused: string[] };
    // Only "Rain" is playing.
    expect(r.paused).toEqual(["s1"]);
    expect(updates).toContainEqual({ sound: "Rain", playing: false, pausedTime: 12 });
  });

  it("resumes a paused sound", async () => {
    await handlePlaylistResume({ playlist: { _id: "pl1" }, sound: { name: "Wind" } });
    expect(updates).toContainEqual({ sound: "Wind", playing: true });
  });

  it("resumes everything paused when no sound is given", async () => {
    const r = (await handlePlaylistResume({ playlist: { _id: "pl1" } })) as { resumed: string[] };
    // Only "Wind" has a pausedTime.
    expect(r.resumed).toEqual(["s2"]);
    expect(updates).toContainEqual({ sound: "Wind", playing: true });
  });

  it("NOT_FOUND for an unknown playlist", async () => {
    await expect(handlePlaylistPlay({ playlist: { name: "Nope" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("NOT_FOUND for an unknown sound", async () => {
    await expect(
      handlePlaylistStopSound({ playlist: { _id: "pl1" }, sound: { name: "Thunder" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

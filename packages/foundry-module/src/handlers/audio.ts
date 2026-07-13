import {
  BridgeError,
  ErrorCode,
  Method,
  Timeout,
  withTimeout,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  type DocRef,
  docToObject,
  findInCollection,
  getCollection,
  getDocumentClass,
} from "../collections.js";

interface SoundDoc {
  id?: string;
  _id?: string;
  name?: string;
  playing?: boolean;
  pausedTime?: number | null;
  /** The live Sound instance; `currentTime` is captured when pausing. */
  sound?: { currentTime?: number };
  update?(data: Record<string, unknown>): Promise<unknown>;
}
interface PlaylistDoc {
  id?: string;
  name?: string;
  sounds?: { contents?: SoundDoc[]; size?: number; get?: (id: string) => SoundDoc | undefined };
  playAll(): Promise<unknown>;
  stopAll(): Promise<unknown>;
  playSound(sound: SoundDoc): Promise<unknown>;
  playNext?(soundId?: string | null, options?: { direction?: number }): Promise<unknown>;
  stopSound?(sound: SoundDoc): Promise<unknown>;
  createEmbeddedDocuments(name: string, data: Record<string, unknown>[]): Promise<unknown[]>;
}

function toSoundData(
  sounds: { name: string; path: string; repeat?: boolean; volume?: number }[],
): Record<string, unknown>[] {
  return sounds.map((s) => ({
    name: s.name,
    path: s.path,
    repeat: s.repeat ?? false,
    volume: s.volume ?? 0.5,
  }));
}

function soundCount(pl: PlaylistDoc): number {
  const s = pl.sounds;
  if (!s) return 0;
  if (typeof s.size === "number") return s.size;
  return s.contents?.length ?? 0;
}

function resolvePlaylist(ref: DocRef): PlaylistDoc {
  const playlists = getCollection("playlists");
  const raw = playlists && findInCollection(playlists, ref);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Playlist not found by ref ${JSON.stringify(ref)}`,
    );
  }
  return raw as PlaylistDoc;
}

/** Resolve a PlaylistSound within a playlist by _id/id or name. */
function findSound(pl: PlaylistDoc, ref: DocRef): SoundDoc {
  const idRef = ref._id ?? ref.id;
  const sounds = pl.sounds?.contents ?? [];
  const sound =
    (idRef && pl.sounds?.get?.(idRef)) ||
    sounds.find((s) => (idRef ? (s.id ?? s._id) === idRef : s.name === ref.name));
  if (!sound) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Sound not found in playlist by ref ${JSON.stringify(ref)}`,
    );
  }
  return sound;
}

export async function handlePlaylistPlay(
  params: ParamsFor<typeof Method.PLAYLIST_PLAY>,
): Promise<Record<string, unknown>> {
  const pl = resolvePlaylist(params.playlist);
  await withTimeout(
    Promise.resolve(pl.playAll()),
    Timeout.AUDIO,
    `Starting playlist '${pl.name ?? pl.id}' did not complete. Don't blindly retry.`,
  );
  return { playlist: pl.id, playing: true };
}

export async function handlePlaylistStop(
  params: ParamsFor<typeof Method.PLAYLIST_STOP>,
): Promise<Record<string, unknown>> {
  const pl = resolvePlaylist(params.playlist);
  await withTimeout(
    Promise.resolve(pl.stopAll()),
    Timeout.AUDIO,
    `Stopping playlist '${pl.name ?? pl.id}' did not complete. Don't blindly retry.`,
  );
  return { playlist: pl.id, playing: false };
}

export async function handlePlaylistPlaySound(
  params: ParamsFor<typeof Method.PLAYLIST_PLAY_SOUND>,
): Promise<Record<string, unknown>> {
  const pl = resolvePlaylist(params.playlist);
  const ref = params.sound;
  const idRef = ref._id ?? ref.id;
  const sounds = pl.sounds?.contents ?? [];
  const sound =
    (idRef && pl.sounds?.get?.(idRef)) ||
    sounds.find((s) => (idRef ? (s.id ?? s._id) === idRef : s.name === ref.name));
  if (!sound) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Sound not found in playlist by ref ${JSON.stringify(ref)}`,
    );
  }
  await withTimeout(
    Promise.resolve(pl.playSound(sound)),
    Timeout.AUDIO,
    `Playing sound in playlist '${pl.name ?? pl.id}' did not complete. Don't blindly retry.`,
  );
  return { playlist: pl.id, sound: docToObject(sound)._id ?? sound.id, playing: true };
}

export async function handlePlaylistNext(
  params: ParamsFor<typeof Method.PLAYLIST_NEXT>,
): Promise<Record<string, unknown>> {
  const pl = resolvePlaylist(params.playlist);
  if (typeof pl.playNext !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Playlist does not support playNext()");
  }
  const direction = params.direction ?? 1;
  await withTimeout(
    Promise.resolve(pl.playNext(null, { direction })),
    Timeout.AUDIO,
    `Advancing playlist '${pl.name ?? pl.id}' did not complete. Don't blindly retry.`,
  );
  return { playlist: pl.id, advanced: true, direction };
}

export async function handlePlaylistStopSound(
  params: ParamsFor<typeof Method.PLAYLIST_STOP_SOUND>,
): Promise<Record<string, unknown>> {
  const pl = resolvePlaylist(params.playlist);
  const sound = findSound(pl, params.sound);
  if (typeof pl.stopSound !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Playlist does not support stopSound()");
  }
  await withTimeout(
    Promise.resolve(pl.stopSound(sound)),
    Timeout.AUDIO,
    `Stopping sound in playlist '${pl.name ?? pl.id}' did not complete. Don't blindly retry.`,
  );
  return { playlist: pl.id, sound: sound.id ?? sound._id, playing: false };
}

export async function handlePlaylistPause(
  params: ParamsFor<typeof Method.PLAYLIST_PAUSE>,
): Promise<Record<string, unknown>> {
  const pl = resolvePlaylist(params.playlist);
  // A PlaylistSound is paused by clearing `playing` and stashing the current
  // playback offset in `pausedTime`. With no `sound`, pause everything playing.
  const targets = params.sound
    ? [findSound(pl, params.sound)]
    : (pl.sounds?.contents ?? []).filter((s) => s.playing);
  const paused: (string | undefined)[] = [];
  for (const s of targets) {
    if (typeof s.update !== "function") continue;
    await withTimeout(
      Promise.resolve(s.update({ playing: false, pausedTime: s.sound?.currentTime ?? 0 })),
      Timeout.AUDIO,
      `Pausing sound in playlist '${pl.name ?? pl.id}' did not complete. Don't blindly retry.`,
    );
    paused.push(s.id ?? s._id);
  }
  return { playlist: pl.id, paused };
}

export async function handlePlaylistResume(
  params: ParamsFor<typeof Method.PLAYLIST_RESUME>,
): Promise<Record<string, unknown>> {
  const pl = resolvePlaylist(params.playlist);
  // Resuming sets `playing` true; Foundry picks up from the stored pausedTime.
  // With no `sound`, resume everything that was paused (has a pausedTime).
  const targets = params.sound
    ? [findSound(pl, params.sound)]
    : (pl.sounds?.contents ?? []).filter((s) => s.pausedTime != null);
  const resumed: (string | undefined)[] = [];
  for (const s of targets) {
    if (typeof s.update !== "function") continue;
    await withTimeout(
      Promise.resolve(s.update({ playing: true })),
      Timeout.AUDIO,
      `Resuming sound in playlist '${pl.name ?? pl.id}' did not complete. Don't blindly retry.`,
    );
    resumed.push(s.id ?? s._id);
  }
  return { playlist: pl.id, resumed };
}

export async function handlePlaylistCreate(
  params: ParamsFor<typeof Method.PLAYLIST_CREATE>,
): Promise<Record<string, unknown>> {
  const cls = getDocumentClass("Playlist");
  if (!cls) {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Playlist document class is not loaded");
  }
  const created = await cls.createDocuments([
    { name: params.name, mode: params.mode ?? 0 },
  ]);
  if (!created.length) {
    throw new BridgeError(ErrorCode.INTERNAL, "Playlist creation returned nothing");
  }
  const pl = created[0] as PlaylistDoc;
  if (params.sounds && params.sounds.length) {
    await pl.createEmbeddedDocuments("PlaylistSound", toSoundData(params.sounds));
  }
  return { playlist: pl.id, name: pl.name, sounds: soundCount(pl) };
}

export async function handlePlaylistAddSounds(
  params: ParamsFor<typeof Method.PLAYLIST_ADD_SOUNDS>,
): Promise<Record<string, unknown>> {
  const pl = resolvePlaylist(params.playlist);
  if (typeof pl.createEmbeddedDocuments !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Playlist does not support createEmbeddedDocuments");
  }
  const created = await pl.createEmbeddedDocuments("PlaylistSound", toSoundData(params.sounds));
  return { playlist: pl.id, added: created.length, sounds: soundCount(pl) };
}

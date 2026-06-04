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
}
interface PlaylistDoc {
  id?: string;
  name?: string;
  sounds?: { contents?: SoundDoc[]; size?: number; get?: (id: string) => SoundDoc | undefined };
  playAll(): Promise<unknown>;
  stopAll(): Promise<unknown>;
  playSound(sound: SoundDoc): Promise<unknown>;
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

export interface WorldGetResult {
  id?: string;
  title?: string;
  system?: { id?: string; version?: string };
  foundryVersion?: string;
  /** Whether the game is currently paused (the Foundry pause banner is showing). */
  paused: boolean;
  counts: {
    users: number;
    actors: number;
    items: number;
    journal: number;
    folders: number;
    scenes: number;
  };
}

function count(collection: { contents: unknown[] } | undefined): number {
  return collection?.contents.length ?? 0;
}

export function handleWorldGet(): WorldGetResult {
  return {
    id: game.world?.id,
    title: game.world?.title,
    system: {
      id: game.system?.id,
      version: game.system?.version,
    },
    foundryVersion: game.version,
    paused: game.paused ?? false,
    counts: {
      users: count(game.users),
      actors: count(game.actors),
      items: count(game.items),
      journal: count(game.journal),
      folders: count(game.folders),
      scenes: count(game.scenes),
    },
  };
}

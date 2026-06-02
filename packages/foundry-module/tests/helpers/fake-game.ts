export interface FakeDoc {
  _id: string;
  name: string;
  [key: string]: unknown;
}

export interface FakeCollection {
  contents: FakeDoc[];
  get(id: string): FakeDoc | undefined;
}

export function makeCollection(docs: FakeDoc[]): FakeCollection {
  return {
    contents: docs,
    get(id: string) {
      return docs.find((d) => d._id === id);
    },
  };
}

export interface FakeGameOptions {
  user?: { isGM: boolean; id: string; name: string };
  world?: { id: string; title: string };
  system?: { id: string; version: string };
  version?: string;
  actors?: FakeDoc[];
  items?: FakeDoc[];
  journal?: FakeDoc[];
  folders?: FakeDoc[];
  scenes?: FakeDoc[];
  users?: FakeDoc[];
  settings?: Record<string, unknown>;
}

export function installFakeGame(opts: FakeGameOptions = {}): () => void {
  const settingsStore = new Map<string, unknown>(
    Object.entries(opts.settings ?? {}),
  );
  const prior = {
    game: (globalThis as { game?: unknown }).game,
    ui: (globalThis as { ui?: unknown }).ui,
    Hooks: (globalThis as { Hooks?: unknown }).Hooks,
  };

  (globalThis as { game: unknown }).game = {
    user: opts.user ?? { isGM: true, id: "gm", name: "GM" },
    world: opts.world,
    system: opts.system,
    version: opts.version,
    actors: makeCollection(opts.actors ?? []),
    items: makeCollection(opts.items ?? []),
    journal: makeCollection(opts.journal ?? []),
    folders: makeCollection(opts.folders ?? []),
    scenes: makeCollection(opts.scenes ?? []),
    users: makeCollection(opts.users ?? []),
    settings: {
      register: () => undefined,
      get: (_ns: string, key: string) => settingsStore.get(key),
      set: async (_ns: string, key: string, value: unknown) => {
        settingsStore.set(key, value);
        return value;
      },
    },
  };
  (globalThis as { ui: unknown }).ui = { notifications: undefined };
  (globalThis as { Hooks: unknown }).Hooks = {
    once: () => undefined,
    on: () => 0,
    off: () => undefined,
    call: () => true,
  };

  return () => {
    if (prior.game === undefined) {
      delete (globalThis as { game?: unknown }).game;
    } else {
      (globalThis as { game: unknown }).game = prior.game;
    }
    if (prior.ui === undefined) {
      delete (globalThis as { ui?: unknown }).ui;
    } else {
      (globalThis as { ui: unknown }).ui = prior.ui;
    }
    if (prior.Hooks === undefined) {
      delete (globalThis as { Hooks?: unknown }).Hooks;
    } else {
      (globalThis as { Hooks: unknown }).Hooks = prior.Hooks;
    }
  };
}

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

export interface FakeDocumentClass {
  createDocuments: (
    data: Record<string, unknown>[],
    context?: Record<string, unknown>,
  ) => Promise<unknown[]>;
  updateDocuments: (
    updates: Record<string, unknown>[],
    context?: Record<string, unknown>,
  ) => Promise<unknown[]>;
  deleteDocuments: (
    ids: string[],
    context?: Record<string, unknown>,
  ) => Promise<unknown[]>;
}

export const WRITABLE_TYPES = [
  "Actor",
  "Item",
  "JournalEntry",
  "Folder",
  "Scene",
  "User",
] as const;
export type WritableType = (typeof WRITABLE_TYPES)[number];

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
  /** Skip installing default Document classes (Actor, Item, etc.) on globalThis. */
  skipDocumentClasses?: boolean;
}

const TYPE_TO_KEY: Record<WritableType, keyof FakeGameOptions> = {
  Actor: "actors",
  Item: "items",
  JournalEntry: "journal",
  Folder: "folders",
  Scene: "scenes",
  User: "users",
};

export function defaultDocumentClass(
  type: WritableType,
  store: FakeDoc[],
): FakeDocumentClass {
  return {
    createDocuments: async (data) => {
      const created = data.map((d, i) => ({
        _id: (d._id as string | undefined) ?? `new-${type}-${Date.now()}-${i}`,
        name: (d.name as string | undefined) ?? `New ${type}`,
        ...d,
      })) as FakeDoc[];
      store.push(...created);
      return created;
    },
    updateDocuments: async (updates) => {
      const updated: FakeDoc[] = [];
      for (const update of updates) {
        const id = update._id as string | undefined;
        if (!id) continue;
        const existing = store.find((d) => d._id === id);
        if (!existing) continue;
        Object.assign(existing, update);
        updated.push(existing);
      }
      return updated;
    },
    deleteDocuments: async (ids) => {
      const removed: FakeDoc[] = [];
      for (const id of ids) {
        const idx = store.findIndex((d) => d._id === id);
        if (idx >= 0) {
          removed.push(store[idx]);
          store.splice(idx, 1);
        }
      }
      return removed;
    },
  };
}

export function installFakeGame(opts: FakeGameOptions = {}): () => void {
  const settingsStore = new Map<string, unknown>(
    Object.entries(opts.settings ?? {}),
  );
  const docClassRestore: Record<string, unknown> = {};
  const stores: Record<WritableType, FakeDoc[]> = {
    Actor: opts.actors ?? [],
    Item: opts.items ?? [],
    JournalEntry: opts.journal ?? [],
    Folder: opts.folders ?? [],
    Scene: opts.scenes ?? [],
    User: opts.users ?? [],
  };
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
    actors: makeCollection(stores.Actor),
    items: makeCollection(stores.Item),
    journal: makeCollection(stores.JournalEntry),
    folders: makeCollection(stores.Folder),
    scenes: makeCollection(stores.Scene),
    users: makeCollection(stores.User),
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

  if (!opts.skipDocumentClasses) {
    for (const type of WRITABLE_TYPES) {
      const key = TYPE_TO_KEY[type];
      void key;
      docClassRestore[type] = (globalThis as Record<string, unknown>)[type];
      (globalThis as Record<string, unknown>)[type] = defaultDocumentClass(
        type,
        stores[type],
      );
    }
  }

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
    for (const type of Object.keys(docClassRestore)) {
      const prev = docClassRestore[type];
      if (prev === undefined) {
        delete (globalThis as Record<string, unknown>)[type];
      } else {
        (globalThis as Record<string, unknown>)[type] = prev;
      }
    }
  };
}

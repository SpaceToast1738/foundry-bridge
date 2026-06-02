export interface FoundryCollection<T = unknown> {
  contents: T[];
  get(id: string): T | undefined;
}

export const READABLE_COLLECTIONS = [
  "actors",
  "items",
  "journal",
  "folders",
  "scenes",
  "users",
] as const;

export type ReadableCollection = (typeof READABLE_COLLECTIONS)[number];

export function isReadableCollection(name: string): name is ReadableCollection {
  return (READABLE_COLLECTIONS as readonly string[]).includes(name);
}

export function getCollection(name: string): FoundryCollection | undefined {
  switch (name) {
    case "actors":
      return game.actors as FoundryCollection | undefined;
    case "items":
      return game.items as FoundryCollection | undefined;
    case "journal":
      return game.journal as FoundryCollection | undefined;
    case "folders":
      return game.folders as FoundryCollection | undefined;
    case "scenes":
      return game.scenes as FoundryCollection | undefined;
    case "users":
      return game.users as FoundryCollection | undefined;
    default:
      return undefined;
  }
}

interface MaybeSerializable {
  toObject?: () => Record<string, unknown>;
  toJSON?: () => Record<string, unknown>;
}

export function docToObject(doc: unknown): Record<string, unknown> {
  if (doc && typeof doc === "object") {
    const maybe = doc as MaybeSerializable;
    if (typeof maybe.toObject === "function") return maybe.toObject();
    if (typeof maybe.toJSON === "function") return maybe.toJSON();
    return { ...(doc as Record<string, unknown>) };
  }
  return {};
}

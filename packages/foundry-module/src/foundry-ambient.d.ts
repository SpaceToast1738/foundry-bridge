// Minimal ambient declarations for the bits of Foundry's client API we touch.
// Replace with @league-of-foundry-developers/foundry-vtt-types once it stabilises
// on a non-beta release.

declare global {
  interface FoundryUser {
    readonly id: string;
    readonly name: string;
    readonly isGM: boolean;
  }

  interface FoundrySettingChoice<T = unknown> {
    name: string;
    hint?: string;
    scope: "world" | "client";
    config: boolean;
    type: { new (): T } | NumberConstructor | StringConstructor | BooleanConstructor;
    default: T;
    range?: { min: number; max: number; step?: number };
    onChange?: (value: T) => void;
  }

  interface FoundrySettings {
    register<T>(namespace: string, key: string, data: FoundrySettingChoice<T>): void;
    get(namespace: string, key: string): unknown;
    set(namespace: string, key: string, value: unknown): Promise<unknown>;
  }

  interface FoundryGame {
    readonly user?: FoundryUser;
    readonly users?: { contents: FoundryUser[]; get(id: string): FoundryUser | undefined };
    readonly settings: FoundrySettings;
    readonly world?: { id: string; title: string };
    readonly system?: { id: string; version: string };
    readonly version?: string;
    readonly actors?: { contents: unknown[]; get(id: string): unknown };
    readonly items?: { contents: unknown[]; get(id: string): unknown };
    readonly journal?: { contents: unknown[]; get(id: string): unknown };
    readonly folders?: { contents: unknown[]; get(id: string): unknown };
    readonly scenes?: {
      contents: unknown[];
      get(id: string): unknown;
      active?: unknown;
    };
    readonly tables?: { contents: unknown[]; get(id: string): unknown };
    readonly playlists?: { contents: unknown[]; get(id: string): unknown };
    readonly macros?: { contents: unknown[]; get(id: string): unknown };
    readonly cards?: { contents: unknown[]; get(id: string): unknown };
    readonly combats?: { contents: unknown[]; get(id: string): unknown };
    readonly combat?: unknown;
    readonly messages?: { contents: unknown[]; get(id: string): unknown };
    readonly socket?: { emit(...args: unknown[]): unknown };
    readonly packs?: { contents: unknown[]; get(id: string): unknown };
    readonly modules?: {
      get(id: string): { version?: string; active?: boolean } | undefined;
    };
    readonly time?: {
      readonly worldTime: number;
      advance(seconds: number): Promise<number> | number;
    };
  }

  interface FoundryHooks {
    once(event: string, handler: (...args: unknown[]) => void): void;
    on(event: string, handler: (...args: unknown[]) => void): number;
    off(event: string, id: number): void;
    call(event: string, ...args: unknown[]): boolean;
  }

  interface FoundryNotifications {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  }

  interface FoundryUI {
    notifications?: FoundryNotifications;
  }

  var Hooks: FoundryHooks;
  var game: FoundryGame;
  var ui: FoundryUI;
  var CONFIG: Record<string, unknown>;
  /** Injected by esbuild (scripts/bundle.mjs) from the manifest version; the
   * actually-running code version. Undefined under tsc (tests). */
  var __BRIDGE_MODULE_VERSION__: string | undefined;
}

export {};

import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import { MODULE_ID } from "../constants.js";

// ---------------------------------------------------------------------------
// Modules (read-only)
// ---------------------------------------------------------------------------

function getModules(): FoundryModulesCollection {
  const modules = game.modules;
  if (!modules || typeof modules.get !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "game.modules is not available");
  }
  return modules;
}

function listModuleInfos(coll: FoundryModulesCollection): FoundryModuleInfo[] {
  if (Array.isArray(coll.contents)) return coll.contents;
  return Array.from(coll);
}

function serializeModule(m: FoundryModuleInfo): Record<string, unknown> {
  const authors: string[] = [];
  if (m.authors) {
    for (const a of m.authors) {
      if (typeof a === "string") authors.push(a);
      else if (a && typeof a.name === "string") authors.push(a.name);
    }
  }
  const requires: string[] = [];
  const req = m.relationships?.requires;
  if (req) {
    for (const r of req) {
      if (r?.id) requires.push(r.id);
    }
  }
  return {
    id: m.id,
    title: m.title ?? m.id,
    version: m.version,
    active: m.active ?? false,
    compatibility: m.compatibility
      ? {
          minimum: m.compatibility.minimum,
          verified: m.compatibility.verified,
          maximum: m.compatibility.maximum,
        }
      : undefined,
    authors: authors.length ? authors : undefined,
    requires: requires.length ? requires : undefined,
  };
}

export function handleModulesList(
  params: ParamsFor<typeof Method.MODULES_LIST>,
): Record<string, unknown> {
  const coll = getModules();
  let mods = listModuleInfos(coll).map(serializeModule);
  if (params?.active !== undefined) {
    mods = mods.filter((m) => m.active === params.active);
  }
  mods.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { count: mods.length, modules: mods };
}

export function handleModuleGet(
  params: ParamsFor<typeof Method.MODULE_GET>,
): Record<string, unknown> {
  const coll = getModules();
  const m = coll.get(params.id);
  if (!m) {
    throw new BridgeError(ErrorCode.NOT_FOUND, `No module with id '${params.id}'`);
  }
  return { ...serializeModule(m), description: m.description };
}

// ---------------------------------------------------------------------------
// Settings (read + write)
// ---------------------------------------------------------------------------

function getSettings(): FoundrySettings {
  const settings = game.settings;
  if (!settings || typeof settings.get !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "game.settings is not available");
  }
  return settings;
}

function typeName(t: unknown): string | undefined {
  if (typeof t === "function") return (t as { name?: string }).name;
  if (t && typeof t === "object") {
    return (t as { constructor?: { name?: string } }).constructor?.name;
  }
  return undefined;
}

function registry(
  settings: FoundrySettings,
): Map<string, FoundrySettingRegistration> | undefined {
  const reg = settings.settings;
  return reg && typeof reg.forEach === "function" ? reg : undefined;
}

export function handleSettingsList(
  params: ParamsFor<typeof Method.SETTINGS_LIST>,
): Record<string, unknown> {
  const settings = getSettings();
  const reg = registry(settings);
  if (!reg) {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "The settings registry (game.settings.settings) is not available",
    );
  }
  const wantNs = params?.namespace;
  const includeValues = params?.include_values ?? false;
  const out: Record<string, unknown>[] = [];
  for (const [fullKey, def] of reg) {
    const namespace = def.namespace ?? fullKey.split(".")[0];
    const key = def.key ?? fullKey.slice(namespace.length + 1);
    if (wantNs && namespace !== wantNs) continue;
    const entry: Record<string, unknown> = {
      namespace,
      key,
      name: def.name,
      scope: def.scope,
      config: def.config,
      type: typeName(def.type),
      default: def.default,
    };
    if (def.choices) entry.choices = def.choices;
    if (includeValues) {
      try {
        entry.value = settings.get(namespace, key);
      } catch {
        entry.value = undefined;
      }
    }
    out.push(entry);
  }
  out.sort((a, b) =>
    `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`),
  );
  return { count: out.length, settings: out };
}

/** Guard reads/writes against unregistered keys for a clear NOT_FOUND. */
function assertRegistered(settings: FoundrySettings, fullKey: string): void {
  const reg = registry(settings);
  if (reg && typeof reg.has === "function" && !reg.has(fullKey)) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Setting '${fullKey}' is not registered (list_settings to see valid keys)`,
    );
  }
}

/**
 * Coerce/validate a setting value against its registered type before writing.
 *
 * Foundry serialises setting values to JSON in the database. If a caller passes
 * a *string* for an Object/Array/Number/Boolean setting (a common mistake — e.g.
 * a JSON string of an object), Foundry stores the double-encoded string; on read
 * it parses back to a string, and code like `Setting.getPermissions` that does
 * `"KEY" in value` throws a TypeError — which can crash world startup (this
 * happened to `core.permissions`). We parse an obvious JSON string back to its
 * value and reject genuine type mismatches with a clear BAD_REQUEST instead of
 * silently corrupting the setting.
 */
function coerceSettingValue(
  value: unknown,
  typeCtor: unknown,
  fullKey: string,
): unknown {
  const name = typeName(typeCtor);
  switch (name) {
    case "String":
      if (typeof value !== "string") {
        throw new BridgeError(
          ErrorCode.BAD_REQUEST,
          `Setting '${fullKey}' expects a string, got ${typeof value}`,
        );
      }
      return value;
    case "Number":
    case "Boolean":
    case "Object":
    case "Array": {
      let v = value;
      // Forgive the common "stringified value" mistake by parsing it back.
      if (typeof v === "string") {
        try {
          v = JSON.parse(v);
        } catch {
          throw new BridgeError(
            ErrorCode.BAD_REQUEST,
            `Setting '${fullKey}' expects ${name}, but received a string that isn't valid JSON`,
          );
        }
      }
      const ok =
        name === "Number"
          ? typeof v === "number"
          : name === "Boolean"
            ? typeof v === "boolean"
            : name === "Array"
              ? Array.isArray(v)
              : v !== null && typeof v === "object" && !Array.isArray(v);
      if (!ok) {
        throw new BridgeError(
          ErrorCode.BAD_REQUEST,
          `Setting '${fullKey}' expects ${name.toLowerCase()}, got ${
            Array.isArray(v) ? "array" : v === null ? "null" : typeof v
          }`,
        );
      }
      return v;
    }
    default:
      // Unknown / custom (DataModel) type — don't interfere.
      return value;
  }
}

export function handleSettingGet(
  params: ParamsFor<typeof Method.SETTING_GET>,
): Record<string, unknown> {
  const settings = getSettings();
  const fullKey = `${params.namespace}.${params.key}`;
  assertRegistered(settings, fullKey);
  let value: unknown;
  try {
    value = settings.get(params.namespace, params.key);
  } catch (err) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Cannot read setting '${fullKey}': ${(err as Error).message}`,
    );
  }
  return { namespace: params.namespace, key: params.key, value };
}

export async function handleSettingSet(
  params: ParamsFor<typeof Method.SETTING_SET>,
): Promise<Record<string, unknown>> {
  // The bridge's own settings gate its permission tiers (writeEnabled,
  // destructiveEnabled, maxDeletePerCall) and relay URL. A write-tier agent
  // must not be able to escalate itself or redirect the relay by writing them.
  if (params.namespace === MODULE_ID) {
    throw new BridgeError(
      ErrorCode.FORBIDDEN,
      `Settings under '${MODULE_ID}' control the bridge itself and cannot be changed via the API; edit them in Foundry's module settings.`,
    );
  }
  const settings = getSettings();
  const fullKey = `${params.namespace}.${params.key}`;
  assertRegistered(settings, fullKey);

  // Validate against the registered type so a wrong-typed value (e.g. a JSON
  // string for an object setting) can't silently corrupt the setting.
  const reg = registry(settings);
  const def = reg?.get(fullKey);
  const value = def
    ? coerceSettingValue(params.value, def.type, fullKey)
    : params.value;

  let stored: unknown;
  try {
    stored = await settings.set(params.namespace, params.key, value);
  } catch (err) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Cannot set setting '${fullKey}': ${(err as Error).message}`,
    );
  }
  return {
    namespace: params.namespace,
    key: params.key,
    value: stored ?? value,
  };
}

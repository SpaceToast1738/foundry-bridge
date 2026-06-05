import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";

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
  const settings = getSettings();
  const fullKey = `${params.namespace}.${params.key}`;
  assertRegistered(settings, fullKey);
  let stored: unknown;
  try {
    stored = await settings.set(params.namespace, params.key, params.value);
  } catch (err) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Cannot set setting '${fullKey}': ${(err as Error).message}`,
    );
  }
  return {
    namespace: params.namespace,
    key: params.key,
    value: stored ?? params.value,
  };
}

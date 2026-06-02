import {
  DEFAULT_MAX_DELETE_PER_CALL,
  DEFAULT_SERVER_URL,
  MODULE_ID,
  SettingKey,
} from "./constants.js";
import type { PermissionState } from "./permissions.js";

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SettingKey.ServerUrl, {
    name: "MCP relay URL",
    hint: "WebSocket URL for the foundry-bridge MCP server. Use ws://127.0.0.1:31414 for local.",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_SERVER_URL,
  });

  game.settings.register(MODULE_ID, SettingKey.WriteEnabled, {
    name: "Enable write tier",
    hint: "Allows create/update and folder operations. Default on.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SettingKey.DestructiveEnabled, {
    name: "Enable destructive tier",
    hint: "Allows document deletes. Default off; turn on deliberately.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SettingKey.MaxDeletePerCall, {
    name: "Max deletes per call",
    hint: "Upper bound on documents deleted in a single destructive call.",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_MAX_DELETE_PER_CALL,
    range: { min: 1, max: 100, step: 1 },
  });
}

export function getPermissionState(): PermissionState {
  return {
    isGM: Boolean(game.user?.isGM),
    writeEnabled: Boolean(game.settings.get(MODULE_ID, SettingKey.WriteEnabled)),
    destructiveEnabled: Boolean(
      game.settings.get(MODULE_ID, SettingKey.DestructiveEnabled),
    ),
    maxDeletePerCall: Number(
      game.settings.get(MODULE_ID, SettingKey.MaxDeletePerCall) ??
        DEFAULT_MAX_DELETE_PER_CALL,
    ),
  };
}

export function getServerUrl(): string {
  return String(
    game.settings.get(MODULE_ID, SettingKey.ServerUrl) ?? DEFAULT_SERVER_URL,
  );
}

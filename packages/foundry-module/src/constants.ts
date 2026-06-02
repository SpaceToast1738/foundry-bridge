export const MODULE_ID = "foundry-bridge";

export const SettingKey = {
  ServerUrl: "serverUrl",
  WriteEnabled: "writeEnabled",
  DestructiveEnabled: "destructiveEnabled",
  MaxDeletePerCall: "maxDeletePerCall",
} as const;

export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_SERVER_URL = "ws://127.0.0.1:31414";
export const DEFAULT_MAX_DELETE_PER_CALL = 5;

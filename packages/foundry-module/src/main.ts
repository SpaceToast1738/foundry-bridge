import { MODULE_ID } from "./constants.js";
import { Bridge } from "./bridge.js";
import { dispatch } from "./dispatch.js";
import { getPermissionState, getServerUrl, registerSettings } from "./settings.js";

let bridge: Bridge | null = null;

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  if (!game.user?.isGM) {
    console.log(`[${MODULE_ID}] non-GM user, bridge disabled`);
    return;
  }
  bridge = new Bridge({
    url: getServerUrl(),
    dispatch,
    getState: getPermissionState,
    logger: { log: console.log, warn: console.warn, error: console.error },
  });
  bridge.connect();
});

import { MODULE_ID } from "../constants.js";
import { getPermissionState } from "../settings.js";
import { handleWorldGet, type WorldGetResult } from "./world.js";

export interface StatusGetResult {
  /** Reported by the module — always true when this handler runs (the relay
   * delivered the call). The server adds `relayConnected` when the module is
   * unreachable; see the mcp-server dispatch for get_status. */
  moduleConnected: true;
  /** Foundry's cached manifest version (can lag — the server caches module.json
   * at boot). Compare with `moduleCodeVersion` (the actually-running bundle). */
  moduleVersion?: string;
  /** The running code version, baked into the bundle at build time. */
  moduleCodeVersion?: string;
  world: WorldGetResult;
  tiers: {
    isGM: boolean;
    writeEnabled: boolean;
    destructiveEnabled: boolean;
    maxDeletePerCall: number;
  };
}

export function handleStatusGet(): StatusGetResult {
  const tiers = getPermissionState();
  return {
    moduleConnected: true,
    moduleVersion: game.modules?.get(MODULE_ID)?.version,
    moduleCodeVersion:
      typeof __BRIDGE_MODULE_VERSION__ !== "undefined" ? __BRIDGE_MODULE_VERSION__ : undefined,
    world: handleWorldGet(),
    tiers: {
      isGM: tiers.isGM,
      writeEnabled: tiers.writeEnabled,
      destructiveEnabled: tiers.destructiveEnabled,
      maxDeletePerCall: tiers.maxDeletePerCall,
    },
  };
}

import {
  BridgeError,
  ErrorCode,
  METHOD_TIERS,
  Method,
  PermissionTier,
} from "@foundry-bridge/shared";

export interface PermissionState {
  isGM: boolean;
  writeEnabled: boolean;
  destructiveEnabled: boolean;
  maxDeletePerCall: number;
}

export function assertAllowed(method: Method, state: PermissionState): void {
  if (!state.isGM) {
    throw new BridgeError(
      ErrorCode.FORBIDDEN,
      "foundry-bridge requires the connected user to be a GM",
    );
  }
  const tier = METHOD_TIERS[method];
  if (tier === PermissionTier.WRITE && !state.writeEnabled) {
    throw new BridgeError(
      ErrorCode.FORBIDDEN,
      `Method '${method}' requires the write tier to be enabled`,
    );
  }
  if (tier === PermissionTier.DESTRUCTIVE && !state.destructiveEnabled) {
    throw new BridgeError(
      ErrorCode.FORBIDDEN,
      `Method '${method}' requires the destructive tier to be enabled`,
    );
  }
}

export function assertBulkLimit(
  method: Method,
  count: number,
  state: PermissionState,
): void {
  if (
    METHOD_TIERS[method] === PermissionTier.DESTRUCTIVE &&
    count > state.maxDeletePerCall
  ) {
    throw new BridgeError(
      ErrorCode.FORBIDDEN,
      `Method '${method}' attempted to act on ${count} entities; limit is ${state.maxDeletePerCall}`,
    );
  }
}

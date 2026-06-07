import * as path from "node:path";

export interface RuntimeConfig {
  credentialsPath: string;
  relayPort: number;
  relayHost: string;
  activeCredentialId: string | undefined;
  requestTimeoutMs: number;
}

const DEFAULT_RELAY_PORT = 31_414;
const DEFAULT_RELAY_HOST = "127.0.0.1";
// How long the relay waits for the module to answer a request before giving up.
// Foundry document writes (large journal pages, re-render + rebroadcast) can be
// slow under load; 30s was too tight and caused mid-task "drops" with late
// "response for unknown id" log lines. Tunable via FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS.
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export function resolveCredentialsPath(
  env: NodeJS.ProcessEnv,
  cwd: string,
): string {
  return (
    env.FOUNDRY_CREDENTIALS ||
    path.join(cwd, "config", "foundry_credentials.json")
  );
}

export function resolveRuntimeConfig(
  env: NodeJS.ProcessEnv,
  cwd: string,
): RuntimeConfig {
  const portRaw = env.FOUNDRY_BRIDGE_PORT;
  const port = portRaw ? Number(portRaw) : DEFAULT_RELAY_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid FOUNDRY_BRIDGE_PORT: ${portRaw}`);
  }

  const timeoutRaw = env.FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS;
  const requestTimeoutMs = timeoutRaw
    ? Number(timeoutRaw)
    : DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000) {
    throw new Error(
      `Invalid FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS: ${timeoutRaw} (must be an integer >= 1000)`,
    );
  }

  return {
    credentialsPath: resolveCredentialsPath(env, cwd),
    relayPort: port,
    relayHost: env.FOUNDRY_BRIDGE_HOST || DEFAULT_RELAY_HOST,
    activeCredentialId: env.FOUNDRY_BRIDGE_CREDENTIAL_ID,
    requestTimeoutMs,
  };
}

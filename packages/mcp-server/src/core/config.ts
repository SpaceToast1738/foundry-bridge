import * as path from "node:path";

export interface RuntimeConfig {
  credentialsPath: string;
  relayPort: number;
  relayHost: string;
  activeCredentialId: string | undefined;
}

const DEFAULT_RELAY_PORT = 31_414;
const DEFAULT_RELAY_HOST = "127.0.0.1";

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
  return {
    credentialsPath: resolveCredentialsPath(env, cwd),
    relayPort: port,
    relayHost: env.FOUNDRY_BRIDGE_HOST || DEFAULT_RELAY_HOST,
    activeCredentialId: env.FOUNDRY_BRIDGE_CREDENTIAL_ID,
  };
}

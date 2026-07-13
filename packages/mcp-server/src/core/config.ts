import * as path from "node:path";

export interface RuntimeConfig {
  credentialsPath: string;
  relayPort: number;
  relayHost: string;
  activeCredentialId: string | undefined;
  requestTimeoutMs: number;
  /** Idle MCP sessions older than this are swept + closed. */
  sessionTtlMs: number;
  /** Hard cap on concurrent MCP sessions; oldest evicted past this. */
  maxSessions: number;
  /** Directory for the durable JSONL audit log, or undefined to disable. */
  auditDir: string | undefined;
}

const DEFAULT_RELAY_PORT = 31_414;
const DEFAULT_RELAY_HOST = "127.0.0.1";
// How long the relay waits for the module to answer a request before giving up.
// Foundry document writes (large journal pages, re-render + rebroadcast) can be
// slow under load; 30s was too tight and caused mid-task "drops" with late
// "response for unknown id" log lines. Tunable via FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS.
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
// In-memory MCP sessions leak if never closed (mcp-remote reconnects, phone
// connector visits). Sweep idle ones and cap the total.
const DEFAULT_SESSION_TTL_MS = 30 * 60_000; // 30 minutes
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_AUDIT_DIR = "/var/lib/foundry-bridge/audit";

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

  const ttlRaw = env.FOUNDRY_BRIDGE_SESSION_TTL_MS;
  const sessionTtlMs = ttlRaw ? Number(ttlRaw) : DEFAULT_SESSION_TTL_MS;
  if (!Number.isInteger(sessionTtlMs) || sessionTtlMs < 10_000) {
    throw new Error(
      `Invalid FOUNDRY_BRIDGE_SESSION_TTL_MS: ${ttlRaw} (must be an integer >= 10000)`,
    );
  }

  const maxRaw = env.FOUNDRY_BRIDGE_MAX_SESSIONS;
  const maxSessions = maxRaw ? Number(maxRaw) : DEFAULT_MAX_SESSIONS;
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new Error(
      `Invalid FOUNDRY_BRIDGE_MAX_SESSIONS: ${maxRaw} (must be an integer >= 1)`,
    );
  }

  // Empty string explicitly disables the audit log; unset uses the default path.
  const auditRaw = env.FOUNDRY_BRIDGE_AUDIT_DIR;
  const auditDir =
    auditRaw === undefined ? DEFAULT_AUDIT_DIR : auditRaw || undefined;

  return {
    credentialsPath: resolveCredentialsPath(env, cwd),
    relayPort: port,
    relayHost: env.FOUNDRY_BRIDGE_HOST || DEFAULT_RELAY_HOST,
    activeCredentialId: env.FOUNDRY_BRIDGE_CREDENTIAL_ID,
    requestTimeoutMs,
    sessionTtlMs,
    maxSessions,
    auditDir,
  };
}

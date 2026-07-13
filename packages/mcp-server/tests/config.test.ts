import * as path from "node:path";
import {
  resolveCredentialsPath,
  resolveRuntimeConfig,
} from "../src/core/config";

describe("resolveCredentialsPath", () => {
  it("honors FOUNDRY_CREDENTIALS when set", () => {
    expect(
      resolveCredentialsPath({ FOUNDRY_CREDENTIALS: "/custom/creds.json" }, "/cwd"),
    ).toBe("/custom/creds.json");
  });

  it("falls back to <cwd>/config/foundry_credentials.json", () => {
    const out = resolveCredentialsPath({}, "/cwd");
    expect(out).toBe(path.join("/cwd", "config", "foundry_credentials.json"));
  });
});

describe("resolveRuntimeConfig", () => {
  it("returns defaults when no env vars are set", () => {
    const cfg = resolveRuntimeConfig({}, "/cwd");
    expect(cfg.relayPort).toBe(31_414);
    expect(cfg.relayHost).toBe("127.0.0.1");
    expect(cfg.activeCredentialId).toBeUndefined();
    expect(cfg.requestTimeoutMs).toBe(120_000);
    expect(cfg.sessionTtlMs).toBe(30 * 60_000);
    expect(cfg.maxSessions).toBe(100);
    expect(cfg.auditDir).toBe("/var/lib/foundry-bridge/audit");
  });

  it("honors session TTL / cap env vars and rejects bad values", () => {
    const cfg = resolveRuntimeConfig(
      { FOUNDRY_BRIDGE_SESSION_TTL_MS: "600000", FOUNDRY_BRIDGE_MAX_SESSIONS: "5" },
      "/cwd",
    );
    expect(cfg.sessionTtlMs).toBe(600_000);
    expect(cfg.maxSessions).toBe(5);
    expect(() =>
      resolveRuntimeConfig({ FOUNDRY_BRIDGE_SESSION_TTL_MS: "5" }, "/cwd"),
    ).toThrow(/Invalid FOUNDRY_BRIDGE_SESSION_TTL_MS/);
    expect(() =>
      resolveRuntimeConfig({ FOUNDRY_BRIDGE_MAX_SESSIONS: "0" }, "/cwd"),
    ).toThrow(/Invalid FOUNDRY_BRIDGE_MAX_SESSIONS/);
  });

  it("FOUNDRY_BRIDGE_AUDIT_DIR overrides the path; empty string disables", () => {
    expect(
      resolveRuntimeConfig({ FOUNDRY_BRIDGE_AUDIT_DIR: "/tmp/audit" }, "/cwd").auditDir,
    ).toBe("/tmp/audit");
    expect(
      resolveRuntimeConfig({ FOUNDRY_BRIDGE_AUDIT_DIR: "" }, "/cwd").auditDir,
    ).toBeUndefined();
  });

  it("honors FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS", () => {
    const cfg = resolveRuntimeConfig(
      { FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS: "180000" },
      "/cwd",
    );
    expect(cfg.requestTimeoutMs).toBe(180_000);
  });

  it("rejects an invalid request timeout", () => {
    expect(() =>
      resolveRuntimeConfig({ FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS: "abc" }, "/cwd"),
    ).toThrow(/Invalid FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS/);
    expect(() =>
      resolveRuntimeConfig({ FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS: "500" }, "/cwd"),
    ).toThrow(/Invalid FOUNDRY_BRIDGE_REQUEST_TIMEOUT_MS/);
  });

  it("honors FOUNDRY_BRIDGE_PORT and FOUNDRY_BRIDGE_HOST", () => {
    const cfg = resolveRuntimeConfig(
      {
        FOUNDRY_BRIDGE_PORT: "8888",
        FOUNDRY_BRIDGE_HOST: "0.0.0.0",
      },
      "/cwd",
    );
    expect(cfg.relayPort).toBe(8888);
    expect(cfg.relayHost).toBe("0.0.0.0");
  });

  it("rejects an invalid port", () => {
    expect(() =>
      resolveRuntimeConfig({ FOUNDRY_BRIDGE_PORT: "wat" }, "/cwd"),
    ).toThrow(/Invalid/);
    expect(() =>
      resolveRuntimeConfig({ FOUNDRY_BRIDGE_PORT: "99999" }, "/cwd"),
    ).toThrow(/Invalid/);
  });

  it("propagates FOUNDRY_BRIDGE_CREDENTIAL_ID", () => {
    const cfg = resolveRuntimeConfig(
      { FOUNDRY_BRIDGE_CREDENTIAL_ID: "shattered-orrery" },
      "/cwd",
    );
    expect(cfg.activeCredentialId).toBe("shattered-orrery");
  });
});

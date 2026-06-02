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

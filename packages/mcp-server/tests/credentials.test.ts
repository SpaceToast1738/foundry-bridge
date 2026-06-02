import {
  getCredentialsInfo,
  parseCredentials,
  resolveCredentialIndex,
  type FoundryCredential,
} from "../src/core/credentials";

const sample: FoundryCredential[] = [
  { _id: "alpha", hostname: "a.example", userid: "u1", password: "p1" },
  { _id: "beta", hostname: "b.example", userid: "u2", password: "p2" },
];

describe("parseCredentials", () => {
  it("parses a valid array", () => {
    const out = parseCredentials(JSON.stringify(sample));
    expect(out).toEqual(sample);
  });

  it("rejects non-array JSON", () => {
    expect(() => parseCredentials("{}")).toThrow(/array/);
  });

  it("rejects entries with missing fields", () => {
    expect(() => parseCredentials(JSON.stringify([{ _id: "x" }]))).toThrow();
  });
});

describe("getCredentialsInfo", () => {
  it("never returns passwords and marks the active entry", () => {
    const info = getCredentialsInfo(sample, 1);
    expect(info).toEqual([
      {
        _id: "alpha",
        hostname: "a.example",
        userid: "u1",
        item_order: 0,
        currently_active: false,
      },
      {
        _id: "beta",
        hostname: "b.example",
        userid: "u2",
        item_order: 1,
        currently_active: true,
      },
    ]);
    expect(JSON.stringify(info)).not.toMatch(/password/);
  });

  it("marks none active when index is negative", () => {
    const info = getCredentialsInfo(sample, -1);
    expect(info.every((i) => !i.currently_active)).toBe(true);
  });
});

describe("resolveCredentialIndex", () => {
  it("resolves by item_order", () => {
    expect(resolveCredentialIndex(sample, { item_order: 1 })).toBe(1);
  });

  it("resolves by _id", () => {
    expect(resolveCredentialIndex(sample, { _id: "alpha" })).toBe(0);
  });

  it("throws for unknown _id", () => {
    expect(() => resolveCredentialIndex(sample, { _id: "missing" })).toThrow();
  });

  it("throws for out-of-range item_order", () => {
    expect(() => resolveCredentialIndex(sample, { item_order: 5 })).toThrow();
  });

  it("throws when neither identifier is supplied", () => {
    expect(() => resolveCredentialIndex(sample, {})).toThrow();
  });
});

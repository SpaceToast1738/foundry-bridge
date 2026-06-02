import { Method } from "@foundry-bridge/shared";
import {
  assertAllowed,
  assertBulkLimit,
  type PermissionState,
} from "../src/permissions";

function state(overrides: Partial<PermissionState> = {}): PermissionState {
  return {
    isGM: true,
    writeEnabled: true,
    destructiveEnabled: true,
    maxDeletePerCall: 5,
    ...overrides,
  };
}

describe("assertAllowed", () => {
  it("rejects non-GM callers for any method", () => {
    expect(() => assertAllowed(Method.PING, state({ isGM: false }))).toThrow(
      /GM/,
    );
  });

  it("allows read methods for a GM regardless of tier toggles", () => {
    expect(() =>
      assertAllowed(
        Method.WORLD_GET,
        state({ writeEnabled: false, destructiveEnabled: false }),
      ),
    ).not.toThrow();
  });

  it("rejects write methods when the write tier is disabled", () => {
    expect(() =>
      assertAllowed(Method.DOCUMENTS_CREATE, state({ writeEnabled: false })),
    ).toThrow(/write tier/);
  });

  it("rejects destructive methods when the destructive tier is disabled", () => {
    expect(() =>
      assertAllowed(
        Method.DOCUMENTS_DELETE,
        state({ destructiveEnabled: false }),
      ),
    ).toThrow(/destructive tier/);
  });

  it("allows destructive methods when both tiers are enabled", () => {
    expect(() => assertAllowed(Method.DOCUMENTS_DELETE, state())).not.toThrow();
  });
});

describe("assertBulkLimit", () => {
  it("permits destructive calls up to the configured limit", () => {
    expect(() =>
      assertBulkLimit(Method.DOCUMENTS_DELETE, 5, state({ maxDeletePerCall: 5 })),
    ).not.toThrow();
  });

  it("rejects destructive calls past the configured limit", () => {
    expect(() =>
      assertBulkLimit(Method.DOCUMENTS_DELETE, 6, state({ maxDeletePerCall: 5 })),
    ).toThrow(/limit is 5/);
  });

  it("does not bulk-limit non-destructive methods", () => {
    expect(() =>
      assertBulkLimit(
        Method.DOCUMENTS_CREATE,
        9999,
        state({ maxDeletePerCall: 1 }),
      ),
    ).not.toThrow();
  });
});

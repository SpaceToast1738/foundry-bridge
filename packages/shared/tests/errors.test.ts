import { BridgeError, ErrorCode, errorPayloadSchema } from "../src/errors";

describe("BridgeError", () => {
  it("toPayload produces a valid error payload", () => {
    const err = new BridgeError(ErrorCode.FORBIDDEN, "no GM");
    const payload = err.toPayload();
    expect(payload).toEqual({ code: "FORBIDDEN", message: "no GM" });
    expect(() => errorPayloadSchema.parse(payload)).not.toThrow();
  });

  it("is an instance of Error", () => {
    const err = new BridgeError(ErrorCode.INTERNAL, "boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BridgeError");
    expect(err.code).toBe(ErrorCode.INTERNAL);
  });
});

import { BridgeError, ErrorCode, Method } from "@foundry-bridge/shared";
import { dispatch, registerHandler } from "../src/dispatch";
import type { PermissionState } from "../src/permissions";

const gmState: PermissionState = {
  isGM: true,
  writeEnabled: true,
  destructiveEnabled: true,
  maxDeletePerCall: 5,
};

describe("dispatch", () => {
  it("handles ping with a pong payload", async () => {
    const res = (await dispatch(Method.PING, {}, gmState)) as {
      pong: boolean;
      timestamp: number;
    };
    expect(res.pong).toBe(true);
    expect(typeof res.timestamp).toBe("number");
  });

  it("rejects unknown methods with BAD_REQUEST", async () => {
    await expect(dispatch("world.nuke", {}, gmState)).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
  });

  it("rejects invalid params with BAD_REQUEST", async () => {
    await expect(
      dispatch(Method.DOCUMENTS_LIST, { collection: "" }, gmState),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it("propagates handler-thrown BridgeError unchanged", async () => {
    registerHandler(Method.WORLD_GET, () => {
      throw new BridgeError(ErrorCode.NOT_FOUND, "no world");
    });
    await expect(dispatch(Method.WORLD_GET, {}, gmState)).rejects.toMatchObject(
      { code: ErrorCode.NOT_FOUND },
    );
  });

  it("respects permission tier — non-GM cannot ping", async () => {
    await expect(
      dispatch(Method.PING, {}, { ...gmState, isGM: false }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("respects write tier — disabled write blocks documents.create", async () => {
    registerHandler(Method.DOCUMENTS_CREATE, () => ({ ok: true }));
    await expect(
      dispatch(
        Method.DOCUMENTS_CREATE,
        { type: "Actor", data: [{ name: "x" }] },
        { ...gmState, writeEnabled: false },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

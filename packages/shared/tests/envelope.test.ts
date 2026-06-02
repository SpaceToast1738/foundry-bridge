import { ZodError } from "zod";
import {
  decodeRequest,
  decodeResponse,
  encode,
  type Request,
  type Response,
} from "../src/envelope";

describe("envelope", () => {
  describe("decodeRequest", () => {
    it("accepts a known method with arbitrary params", () => {
      const req = decodeRequest({
        id: "1",
        method: "documents.list",
        params: { collection: "actors" },
      });
      expect(req.id).toBe("1");
      expect(req.method).toBe("documents.list");
    });

    it("rejects an unknown method", () => {
      expect(() =>
        decodeRequest({ id: "1", method: "world.nuke", params: {} }),
      ).toThrow(ZodError);
    });

    it("rejects an empty id", () => {
      expect(() =>
        decodeRequest({ id: "", method: "ping", params: {} }),
      ).toThrow(ZodError);
    });

    it("parses a JSON string", () => {
      const req = decodeRequest(
        JSON.stringify({ id: "x", method: "ping", params: {} }),
      );
      expect(req.method).toBe("ping");
    });
  });

  describe("decodeResponse", () => {
    it("accepts an ok response", () => {
      const res = decodeResponse({ id: "1", ok: true, result: { a: 1 } });
      expect(res.ok).toBe(true);
    });

    it("accepts an error response", () => {
      const res = decodeResponse({
        id: "1",
        ok: false,
        error: { code: "FORBIDDEN", message: "nope" },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
    });

    it("rejects an error response with an unknown code", () => {
      expect(() =>
        decodeResponse({
          id: "1",
          ok: false,
          error: { code: "WAT", message: "nope" },
        }),
      ).toThrow(ZodError);
    });

    it("rejects a response that mixes result and error", () => {
      expect(() =>
        decodeResponse({
          id: "1",
          ok: true,
          error: { code: "FORBIDDEN", message: "nope" },
        }),
      ).toThrow(ZodError);
    });
  });

  describe("encode", () => {
    it("roundtrips a request", () => {
      const req: Request = { id: "1", method: "ping", params: {} };
      expect(decodeRequest(encode(req))).toEqual(req);
    });

    it("roundtrips a response", () => {
      const res: Response = { id: "1", ok: true, result: 42 };
      expect(decodeResponse(encode(res))).toEqual(res);
    });
  });
});

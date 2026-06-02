import { ZodError } from "zod";
import {
  METHOD_TIERS,
  Method,
  PermissionTier,
  paramSchemas,
} from "../src/methods";

describe("methods", () => {
  describe("paramSchemas", () => {
    it("requires collection for documents.list", () => {
      expect(() =>
        paramSchemas[Method.DOCUMENTS_LIST].parse({}),
      ).toThrow(ZodError);
    });

    it("accepts a valid documents.list", () => {
      const parsed = paramSchemas[Method.DOCUMENTS_LIST].parse({
        collection: "actors",
        where: { type: "npc" },
        max_length: 1000,
      });
      expect(parsed.collection).toBe("actors");
    });

    it("requires at least one ref field for documents.get", () => {
      expect(() =>
        paramSchemas[Method.DOCUMENTS_GET].parse({
          collection: "actors",
          ref: {},
        }),
      ).toThrow(ZodError);
    });

    it("accepts a documents.get ref by name only", () => {
      const parsed = paramSchemas[Method.DOCUMENTS_GET].parse({
        collection: "actors",
        ref: { name: "Gandalf" },
      });
      expect(parsed.ref.name).toBe("Gandalf");
    });

    it("requires non-empty data array for documents.create", () => {
      expect(() =>
        paramSchemas[Method.DOCUMENTS_CREATE].parse({ type: "Actor", data: [] }),
      ).toThrow(ZodError);
    });

    it("requires non-empty ids array for documents.delete", () => {
      expect(() =>
        paramSchemas[Method.DOCUMENTS_DELETE].parse({ type: "Actor", ids: [] }),
      ).toThrow(ZodError);
    });

    it("accepts a folders.move with null folder (move to root)", () => {
      const parsed = paramSchemas[Method.FOLDERS_MOVE].parse({
        type: "JournalEntry",
        entity: { _id: "abc" },
        folder: null,
      });
      expect(parsed.folder).toBeNull();
    });
  });

  describe("METHOD_TIERS", () => {
    it("classifies read methods as READ", () => {
      expect(METHOD_TIERS[Method.PING]).toBe(PermissionTier.READ);
      expect(METHOD_TIERS[Method.WORLD_GET]).toBe(PermissionTier.READ);
      expect(METHOD_TIERS[Method.DOCUMENTS_LIST]).toBe(PermissionTier.READ);
      expect(METHOD_TIERS[Method.DOCUMENTS_GET]).toBe(PermissionTier.READ);
    });

    it("classifies create/update/folder methods as WRITE", () => {
      expect(METHOD_TIERS[Method.DOCUMENTS_CREATE]).toBe(PermissionTier.WRITE);
      expect(METHOD_TIERS[Method.DOCUMENTS_UPDATE]).toBe(PermissionTier.WRITE);
      expect(METHOD_TIERS[Method.FOLDERS_CREATE]).toBe(PermissionTier.WRITE);
      expect(METHOD_TIERS[Method.FOLDERS_MOVE]).toBe(PermissionTier.WRITE);
    });

    it("classifies delete as DESTRUCTIVE", () => {
      expect(METHOD_TIERS[Method.DOCUMENTS_DELETE]).toBe(
        PermissionTier.DESTRUCTIVE,
      );
    });

    it("has a tier for every method", () => {
      for (const method of Object.values(Method)) {
        expect(METHOD_TIERS[method]).toBeDefined();
      }
    });
  });
});

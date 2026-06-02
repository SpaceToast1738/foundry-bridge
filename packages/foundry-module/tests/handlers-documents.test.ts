import { ErrorCode } from "@foundry-bridge/shared";
import {
  handleDocumentsGet,
  handleDocumentsList,
} from "../src/handlers/documents";
import { installFakeGame } from "./helpers/fake-game";

describe("handleDocumentsList", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("returns all documents in a known collection", () => {
    uninstall = installFakeGame({
      actors: [
        { _id: "1", name: "a", type: "npc" },
        { _id: "2", name: "b", type: "character" },
      ],
    });
    const out = handleDocumentsList({ collection: "actors" });
    expect(out.count).toBe(2);
    expect(out.documents.map((d) => d._id)).toEqual(["1", "2"]);
  });

  it("filters with where", () => {
    uninstall = installFakeGame({
      actors: [
        { _id: "1", name: "a", type: "npc" },
        { _id: "2", name: "b", type: "character" },
      ],
    });
    const out = handleDocumentsList({
      collection: "actors",
      where: { type: "npc" },
    });
    expect(out.count).toBe(1);
    expect(out.documents[0]).toMatchObject({ _id: "1" });
  });

  it("projects with requested_fields and preserves _id and name", () => {
    uninstall = installFakeGame({
      actors: [{ _id: "1", name: "a", type: "npc", level: 5 }],
    });
    const out = handleDocumentsList({
      collection: "actors",
      requested_fields: ["level"],
    });
    expect(out.documents[0]).toEqual({ _id: "1", name: "a", level: 5 });
  });

  it("truncates with max_length", () => {
    uninstall = installFakeGame({
      actors: Array.from({ length: 20 }, (_, i) => ({
        _id: String(i),
        name: "x".repeat(40),
      })),
    });
    const out = handleDocumentsList({ collection: "actors", max_length: 200 });
    expect(out.count).toBeLessThan(20);
  });

  it("calls toObject() if the document exposes one", () => {
    uninstall = installFakeGame({
      actors: [
        Object.assign(Object.create({ toObject: () => ({ _id: "1", name: "from-toObject" }) }), {
          _id: "raw",
          name: "raw",
        }),
      ],
    });
    const out = handleDocumentsList({ collection: "actors" });
    expect(out.documents[0]).toEqual({ _id: "1", name: "from-toObject" });
  });

  it("rejects unknown collections with BAD_REQUEST", () => {
    uninstall = installFakeGame({});
    expect(() => handleDocumentsList({ collection: "wat" })).toThrow(
      expect.objectContaining({ code: ErrorCode.BAD_REQUEST }),
    );
  });
});

describe("handleDocumentsGet", () => {
  let uninstall: () => void;
  afterEach(() => uninstall?.());

  it("fetches by _id", () => {
    uninstall = installFakeGame({
      actors: [{ _id: "abc", name: "Aragorn", type: "character" }],
    });
    const out = handleDocumentsGet({
      collection: "actors",
      ref: { _id: "abc" },
    });
    expect(out.name).toBe("Aragorn");
  });

  it("fetches by name when _id misses", () => {
    uninstall = installFakeGame({
      items: [{ _id: "i1", name: "Sting" }],
    });
    const out = handleDocumentsGet({
      collection: "items",
      ref: { name: "Sting" },
    });
    expect(out._id).toBe("i1");
  });

  it("returns NOT_FOUND when neither id nor name matches", () => {
    uninstall = installFakeGame({ actors: [{ _id: "a", name: "x" }] });
    expect(() =>
      handleDocumentsGet({ collection: "actors", ref: { name: "missing" } }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.NOT_FOUND }));
  });

  it("applies requested_fields projection", () => {
    uninstall = installFakeGame({
      actors: [{ _id: "a", name: "x", type: "npc", level: 3 }],
    });
    const out = handleDocumentsGet({
      collection: "actors",
      ref: { _id: "a" },
      requested_fields: ["level"],
    });
    expect(out).toEqual({ _id: "a", name: "x", level: 3 });
  });
});

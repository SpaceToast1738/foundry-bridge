import {
  filterDocumentFields,
  filterDocumentsByWhere,
  truncateDocuments,
} from "../src/document-utils";

describe("filterDocumentFields", () => {
  it("returns the doc unchanged when no fields are requested", () => {
    const doc = { _id: "a", name: "x", type: "npc" };
    expect(filterDocumentFields(doc, null)).toBe(doc);
    expect(filterDocumentFields(doc, [])).toBe(doc);
  });

  it("always includes _id and name even if not requested", () => {
    const doc = { _id: "a", name: "x", type: "npc", level: 5 };
    expect(filterDocumentFields(doc, ["type"])).toEqual({
      _id: "a",
      name: "x",
      type: "npc",
    });
  });

  it("omits fields not present on the doc", () => {
    const doc = { _id: "a", name: "x" };
    expect(filterDocumentFields(doc, ["missing"])).toEqual({ _id: "a", name: "x" });
  });
});

describe("filterDocumentsByWhere", () => {
  const docs = [
    { _id: "1", name: "a", type: "npc", folder: "f1" },
    { _id: "2", name: "b", type: "character", folder: "f1" },
    { _id: "3", name: "c", type: "npc", folder: "f2" },
  ];

  it("returns all docs when where is empty or null", () => {
    expect(filterDocumentsByWhere(docs, null)).toHaveLength(3);
    expect(filterDocumentsByWhere(docs, {})).toHaveLength(3);
  });

  it("filters by a single field", () => {
    expect(filterDocumentsByWhere(docs, { type: "npc" })).toHaveLength(2);
  });

  it("combines multiple conditions with AND", () => {
    const filtered = filterDocumentsByWhere(docs, {
      type: "npc",
      folder: "f1",
    });
    expect(filtered).toEqual([docs[0]]);
  });
});

describe("truncateDocuments", () => {
  it("returns the input when maxLength is 0 or undefined", () => {
    const docs = [{ a: 1 }, { b: 2 }];
    expect(truncateDocuments(docs, 0)).toEqual(docs);
    expect(truncateDocuments(docs, undefined)).toEqual(docs);
  });

  it("drops trailing docs until the JSON fits the byte budget", () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({ _id: String(i), filler: "x".repeat(50) }));
    const truncated = truncateDocuments(docs, 200);
    expect(truncated.length).toBeLessThan(docs.length);
    expect(JSON.stringify(truncated).length).toBeLessThanOrEqual(200);
  });

  it("returns an empty array when even a single doc exceeds maxLength", () => {
    const docs = [{ huge: "x".repeat(1000) }];
    expect(truncateDocuments(docs, 10)).toEqual([]);
  });

  it("counts bytes via TextEncoder so multibyte chars are handled", () => {
    const docs = [{ name: "你好" }];
    expect(truncateDocuments(docs, 100)).toEqual(docs);
  });
});

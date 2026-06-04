import {
  filterDocumentFields,
  filterDocumentsByWhere,
  sortDocuments,
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

describe("sortDocuments", () => {
  it("returns a copy unchanged when no field is given", () => {
    const docs = [{ name: "b" }, { name: "a" }];
    expect(sortDocuments(docs, undefined, undefined)).toEqual(docs);
  });

  it("sorts ascending by a top-level field (numeric-aware, case-insensitive)", () => {
    const docs = [{ name: "Banana" }, { name: "apple" }, { name: "cherry" }];
    expect(sortDocuments(docs, "name", "asc").map((d) => d.name)).toEqual([
      "apple",
      "Banana",
      "cherry",
    ]);
  });

  it("sorts descending and by dotted path", () => {
    const docs = [
      { name: "a", system: { cr: 2 } },
      { name: "b", system: { cr: 10 } },
      { name: "c", system: { cr: 1 } },
    ];
    expect(sortDocuments(docs, "system.cr", "desc").map((d) => d.name)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("keeps missing values last in both directions and is stable", () => {
    const docs = [
      { name: "a", v: 2 },
      { name: "b" },
      { name: "c", v: 1 },
      { name: "d" },
    ];
    expect(sortDocuments(docs, "v", "asc").map((d) => d.name)).toEqual(["c", "a", "b", "d"]);
    expect(sortDocuments(docs, "v", "desc").map((d) => d.name)).toEqual(["a", "c", "b", "d"]);
  });

  it("does not mutate the input array", () => {
    const docs = [{ name: "b" }, { name: "a" }];
    const before = [...docs];
    sortDocuments(docs, "name", "asc");
    expect(docs).toEqual(before);
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

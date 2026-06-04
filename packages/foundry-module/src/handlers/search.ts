import {
  BridgeError,
  ErrorCode,
  type ParamsFor,
  Method,
} from "@foundry-bridge/shared";
import {
  READABLE_COLLECTIONS,
  docToObject,
  getCollection,
  isReadableCollection,
} from "../collections.js";

interface SearchHit {
  collection: string;
  _id: unknown;
  name: unknown;
  uuid?: unknown;
  snippet?: string;
}

const DEFAULT_LIMIT = 50;
const SNIPPET_RADIUS = 60;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Concatenate the plain text of a JournalEntry's text pages. */
function journalText(obj: Record<string, unknown>): string {
  const pages = obj.pages;
  if (!Array.isArray(pages)) return "";
  const parts: string[] = [];
  for (const page of pages) {
    const p = page as Record<string, unknown>;
    const text = p.text as Record<string, unknown> | undefined;
    const content = text?.content;
    if (typeof content === "string") parts.push(stripHtml(content));
    if (typeof p.name === "string") parts.push(p.name);
  }
  return parts.join(" — ");
}

function makeSnippet(text: string, matchIndex: number, queryLen: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + queryLen + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).trim() + suffix;
}

/** Read a (possibly dotted) field path off a serialized doc. */
function valueAtPath(obj: Record<string, unknown>, path: string): unknown {
  if (path in obj) return obj[path];
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function handleDocumentsSearch(
  params: ParamsFor<typeof Method.DOCUMENTS_SEARCH>,
): { query: string; count: number; results: SearchHit[] } {
  const targets =
    params.collections && params.collections.length > 0
      ? params.collections
      : [...READABLE_COLLECTIONS];

  for (const name of targets) {
    if (!isReadableCollection(name)) {
      throw new BridgeError(
        ErrorCode.BAD_REQUEST,
        `Unknown collection '${name}'`,
      );
    }
  }

  const includeText = params.include_text !== false;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const needle = params.query.toLowerCase();
  const typeFilter = params.type;
  const matchFields = params.match_fields ?? [];
  const results: SearchHit[] = [];

  for (const name of targets) {
    const collection = getCollection(name);
    if (!collection) continue;
    for (const raw of collection.contents) {
      if (results.length >= limit) break;
      const obj = docToObject(raw);
      if (typeFilter && obj.type !== typeFilter) continue;
      const docName = typeof obj.name === "string" ? obj.name : "";

      if (docName.toLowerCase().includes(needle)) {
        results.push({ collection: name, _id: obj._id, name: obj.name, uuid: obj.uuid });
        continue;
      }

      // Optional: also match the query within explicit (dotted) string fields.
      let fieldHit = false;
      for (const field of matchFields) {
        const v = valueAtPath(obj, field);
        if (typeof v === "string" && v.toLowerCase().includes(needle)) {
          results.push({
            collection: name,
            _id: obj._id,
            name: obj.name,
            uuid: obj.uuid,
            snippet: `${field}: ${makeSnippet(v, v.toLowerCase().indexOf(needle), needle.length)}`,
          });
          fieldHit = true;
          break;
        }
      }
      if (fieldHit) continue;

      if (includeText && name === "journal") {
        const text = journalText(obj);
        const idx = text.toLowerCase().indexOf(needle);
        if (idx >= 0) {
          results.push({
            collection: name,
            _id: obj._id,
            name: obj.name,
            uuid: obj.uuid,
            snippet: makeSnippet(text, idx, needle.length),
          });
        }
      }
    }
    if (results.length >= limit) break;
  }

  return { query: params.query, count: results.length, results };
}

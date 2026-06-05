import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  READABLE_COLLECTIONS,
  docToObject,
  getCollection,
  isReadableCollection,
} from "../collections.js";

// @UUID[<inner>]{<label>} — label is optional.
const UUID_RE = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;

// HTML fields (besides journal pages) that commonly carry content links.
const HTML_SYSTEM_PATHS = ["description.value", "biography.value", "details.biography.value"];

function valueAtPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** The content-bearing HTML fields of a serialized document. */
function* htmlFields(
  collection: string,
  obj: Record<string, unknown>,
): Generator<{ field: string; value: string; pageId?: string }> {
  if (collection === "journal" && Array.isArray(obj.pages)) {
    for (const page of obj.pages) {
      const p = page as Record<string, unknown>;
      const content = (p.text as Record<string, unknown> | undefined)?.content;
      if (typeof content === "string") {
        yield { field: "pages.text.content", value: content, pageId: p._id as string };
      }
    }
  }
  for (const path of HTML_SYSTEM_PATHS) {
    const v = valueAtPath(obj.system, path);
    if (typeof v === "string") yield { field: `system.${path}`, value: v };
  }
}

/** Bare id of a target given as a uuid (`Type.id`, `Compendium.pack.id`) or raw _id. */
function targetIdOf(target: string): string {
  return target.includes(".") ? (target.split(".").pop() ?? target) : target;
}

function resolveTargetName(targetId: string): string | undefined {
  for (const name of READABLE_COLLECTIONS) {
    const col = getCollection(name) as { get?: (id: string) => unknown } | undefined;
    const doc = col?.get?.(targetId);
    if (doc) {
      const n = docToObject(doc).name;
      return typeof n === "string" ? n : undefined;
    }
  }
  return undefined;
}

interface Reference {
  in: string;
  collection: string;
  _id: unknown;
  field: string;
  page_id?: string;
  link: string;
  label: string | null;
  stale: boolean;
}

export function handleFindReferences(
  params: ParamsFor<typeof Method.DOCUMENTS_FIND_REFS>,
): { target: string; current_name: string | null; count: number; references: Reference[] } {
  const targetId = targetIdOf(params.target);
  const currentName = resolveTargetName(targetId);
  const limit = params.limit ?? 100;
  const targets =
    params.collections && params.collections.length > 0
      ? params.collections
      : [...READABLE_COLLECTIONS];

  for (const name of targets) {
    if (!isReadableCollection(name)) {
      throw new BridgeError(ErrorCode.BAD_REQUEST, `Unknown collection '${name}'`);
    }
  }

  const references: Reference[] = [];
  for (const name of targets) {
    const col = getCollection(name);
    if (!col) continue;
    for (const raw of col.contents) {
      if (references.length >= limit) break;
      const obj = docToObject(raw);
      for (const f of htmlFields(name, obj)) {
        for (const m of f.value.matchAll(UUID_RE)) {
          const inner = m[1];
          const label = m[2];
          if (!inner.includes(targetId)) continue;
          references.push({
            in: `${name}.${String(obj._id)}${f.pageId ? `/page ${f.pageId}` : ""}`,
            collection: name,
            _id: obj._id,
            field: f.field,
            page_id: f.pageId,
            link: `@UUID[${inner}]`,
            label: label ?? null,
            stale: Boolean(label && currentName && label !== currentName),
          });
        }
      }
    }
    if (references.length >= limit) break;
  }
  return {
    target: params.target,
    current_name: currentName ?? null,
    count: references.length,
    references,
  };
}

/** Rewrite stale labels for links to `targetId` within an HTML string. Returns null if unchanged. */
function rewriteLabels(content: string, targetId: string, name: string): string | null {
  let changed = false;
  const out = content.replace(UUID_RE, (full, inner: string, label?: string) => {
    if (inner.includes(targetId) && label !== undefined && label !== name) {
      changed = true;
      return `@UUID[${inner}]{${name}}`;
    }
    return full;
  });
  return changed ? out : null;
}

interface LiveDoc {
  update?: (data: Record<string, unknown>) => Promise<unknown>;
  updateEmbeddedDocuments?: (name: string, updates: Record<string, unknown>[]) => Promise<unknown[]>;
}

export async function handleRefreshLabels(
  params: ParamsFor<typeof Method.DOCUMENTS_REFRESH_LABELS>,
): Promise<Record<string, unknown>> {
  const targetId = targetIdOf(params.target);
  const currentName = resolveTargetName(targetId);
  if (!currentName) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Target ${params.target} not found in the world (or has no name)`,
    );
  }
  if (params.dry_run) {
    const found = handleFindReferences({ target: params.target });
    return {
      dry_run: true,
      target: params.target,
      current_name: currentName,
      would_update: found.references.filter((r) => r.stale),
    };
  }

  let updated = 0;
  for (const name of READABLE_COLLECTIONS) {
    const col = getCollection(name);
    if (!col) continue;
    for (const raw of col.contents) {
      const live = raw as LiveDoc;
      const obj = docToObject(raw);
      if (name === "journal" && Array.isArray(obj.pages)) {
        const pageUpdates: Record<string, unknown>[] = [];
        for (const page of obj.pages) {
          const p = page as Record<string, unknown>;
          const content = (p.text as Record<string, unknown> | undefined)?.content;
          if (typeof content === "string") {
            const next = rewriteLabels(content, targetId, currentName);
            if (next !== null) pageUpdates.push({ _id: p._id, text: { content: next } });
          }
        }
        if (pageUpdates.length && typeof live.updateEmbeddedDocuments === "function") {
          await live.updateEmbeddedDocuments("JournalEntryPage", pageUpdates);
          updated += pageUpdates.length;
        }
      } else if (typeof live.update === "function") {
        const upd: Record<string, unknown> = {};
        for (const path of HTML_SYSTEM_PATHS) {
          const v = valueAtPath(obj.system, path);
          if (typeof v === "string") {
            const next = rewriteLabels(v, targetId, currentName);
            if (next !== null) upd[`system.${path}`] = next;
          }
        }
        if (Object.keys(upd).length) {
          await live.update(upd);
          updated += 1;
        }
      }
    }
  }
  return { target: params.target, current_name: currentName, updated };
}

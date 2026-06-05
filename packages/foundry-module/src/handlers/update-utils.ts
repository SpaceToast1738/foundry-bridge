import { BridgeError, ErrorCode } from "@foundry-bridge/shared";

/** Top-level keys an agent must never unset. */
const PROTECTED_UNSET = new Set(["_id", "_stats"]);

export const DRY_RUN_NOTE =
  "Preview shows direct field writes only — derived data, Active Effect recalculation, and hooks are not reflected.";

/**
 * Turn one update entry into the object passed to Foundry's `update*`:
 * pass-through the data, and translate an optional `unset: string[]` (dotted
 * paths) into Foundry's flattened deletion keys (`parent.-=key`). The agent
 * never sees raw `-=` syntax.
 */
export function buildUpdateEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const { unset, ...data } = entry;
  const update: Record<string, unknown> = { ...data };
  if (unset === undefined) return update;
  if (!Array.isArray(unset) || unset.some((p) => typeof p !== "string")) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      "`unset` must be an array of field-path strings",
    );
  }
  for (const path of unset as string[]) {
    const top = path.split(".")[0];
    if (!path || PROTECTED_UNSET.has(top)) {
      throw new BridgeError(
        ErrorCode.BAD_REQUEST,
        `Cannot unset protected or empty path '${path}'`,
      );
    }
    const i = path.lastIndexOf(".");
    const parent = i === -1 ? "" : `${path.slice(0, i)}.`;
    const key = i === -1 ? path : path.slice(i + 1);
    update[`${parent}-=${key}`] = null; // Foundry honours -= on update
  }
  return update;
}

interface FoundryUtils {
  diffObject(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown>;
}

/** Foundry's client-side utilities (diffObject etc.), if present. */
export function foundryUtils(): FoundryUtils | undefined {
  const fu = (globalThis as { foundry?: { utils?: unknown } }).foundry?.utils;
  return fu && typeof (fu as FoundryUtils).diffObject === "function"
    ? (fu as FoundryUtils)
    : undefined;
}

export interface CloneableDoc {
  toObject(): Record<string, unknown>;
  clone(data: Record<string, unknown>, context?: Record<string, unknown>): CloneableDoc;
}

/**
 * Compute a dry-run diff for a document update: clone (which runs validators,
 * surfacing bad updates in preview) and diff before→after. Falls back to the
 * raw update payload if Foundry's clone/diff utilities aren't available.
 */
export function previewUpdate(
  doc: unknown,
  updates: Record<string, unknown>[],
): unknown {
  const built = updates.map((u) => buildUpdateEntry(u));
  const fu = foundryUtils();
  const d = doc as Partial<CloneableDoc>;
  if (fu && typeof d.clone === "function" && typeof d.toObject === "function") {
    const before = d.toObject();
    let cloned: CloneableDoc = d as CloneableDoc;
    for (const u of built) cloned = cloned.clone(u, { keepId: true });
    return fu.diffObject(before, cloned.toObject());
  }
  return built;
}

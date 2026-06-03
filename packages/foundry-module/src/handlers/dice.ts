import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import { findInCollection, getCollection } from "../collections.js";

interface RollResult {
  total: number;
  result: string;
  dice?: { faces?: number; results?: { result?: number }[] }[];
}
interface RollInstance extends RollResult {
  evaluate(): Promise<RollInstance>;
}
interface RollCtor {
  new (formula: string, data?: Record<string, unknown>): RollInstance;
}

function getRoll(): RollCtor {
  const cls = (globalThis as Record<string, unknown>).Roll as RollCtor | undefined;
  if (typeof cls !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Roll class is not loaded");
  }
  return cls;
}

export async function handleDiceRoll(
  params: ParamsFor<typeof Method.DICE_ROLL>,
): Promise<Record<string, unknown>> {
  const Roll = getRoll();
  let roll: RollInstance;
  try {
    roll = new Roll(params.formula, params.data ?? {});
    await roll.evaluate();
  } catch (err) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Invalid roll formula '${params.formula}': ${(err as Error).message}`,
    );
  }
  return {
    formula: params.formula,
    total: roll.total,
    result: roll.result,
    dice: (roll.dice ?? []).map((d) => ({
      faces: d.faces,
      results: (d.results ?? []).map((r) => r.result),
    })),
  };
}

interface TableDoc {
  name?: string;
  draw(options: Record<string, unknown>): Promise<{
    roll?: { total?: number };
    results: Record<string, unknown>[];
  }>;
}

export async function handleTableDraw(
  params: ParamsFor<typeof Method.TABLE_DRAW>,
): Promise<Record<string, unknown>> {
  const tables = getCollection("tables");
  const raw = tables && findInCollection(tables, params.ref);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Roll table not found by ref ${JSON.stringify(params.ref)}`,
    );
  }
  const table = raw as TableDoc;
  const options: Record<string, unknown> = { displayChat: false, replacement: true };
  if (params.formula) {
    options.roll = new (getRoll())(params.formula);
  }
  const out = await table.draw(options);
  const results = out.results.map((r) => ({
    text: r.text ?? r.name,
    documentUuid: r.documentUuid ?? r.documentId,
    img: r.img ?? r.icon,
  }));
  return { table: table.name, total: out.roll?.total, results };
}

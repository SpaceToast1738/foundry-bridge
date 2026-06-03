import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import { findInCollection, getCollection } from "../collections.js";

interface MacroDoc {
  id?: string;
  name?: string;
  execute(scope?: Record<string, unknown>): Promise<unknown> | unknown;
}

export async function handleMacroExecute(
  params: ParamsFor<typeof Method.MACRO_EXECUTE>,
): Promise<Record<string, unknown>> {
  const macros = getCollection("macros");
  const raw = macros && findInCollection(macros, params.macro);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Macro not found by ref ${JSON.stringify(params.macro)}`,
    );
  }
  const macro = raw as MacroDoc;
  if (typeof macro.execute !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Macro does not support execute()");
  }
  let result: unknown;
  try {
    result = await macro.execute(params.args ?? {});
  } catch (err) {
    throw new BridgeError(
      ErrorCode.INTERNAL,
      `Macro execution failed: ${(err as Error).message}`,
    );
  }
  // Macro results are often undefined/non-serialisable; report success + any simple value.
  const simple =
    result === undefined || result === null || typeof result === "object"
      ? undefined
      : result;
  return { macro: macro.id, executed: true, result: simple };
}

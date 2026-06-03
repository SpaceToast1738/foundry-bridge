import {
  BridgeError,
  ErrorCode,
  Method,
  methodSchema,
  paramSchemas,
} from "@foundry-bridge/shared";
import { ZodError } from "zod";
import { assertAllowed, type PermissionState } from "./permissions.js";
import { handlePing } from "./handlers/ping.js";
import { handleWorldGet } from "./handlers/world.js";
import {
  handleDocumentsCreate,
  handleDocumentsDelete,
  handleDocumentsGet,
  handleDocumentsList,
  handleDocumentsUpdate,
} from "./handlers/documents.js";
import { handleDocumentsSearch } from "./handlers/search.js";
import {
  handleEmbeddedCreate,
  handleEmbeddedDelete,
  handleEmbeddedUpdate,
} from "./handlers/embedded.js";
import {
  handleCompendiumImport,
  handleCompendiumList,
  handleCompendiumSearch,
} from "./handlers/compendium.js";
import {
  handleFoldersCreate,
  handleFoldersMove,
} from "./handlers/folders.js";
import { handleMessagesCreate } from "./handlers/messages.js";
import {
  handleSceneActivate,
  handleSceneActive,
  handleTokenPlace,
  handleTokenUpdate,
} from "./handlers/scenes.js";
import { handleDiceRoll, handleTableDraw } from "./handlers/dice.js";
import {
  handleCombatAdd,
  handleCombatAdvance,
  handleCombatCreate,
  handleCombatRollInitiative,
} from "./handlers/combat.js";

export type Handler = (
  params: unknown,
  state: PermissionState,
) => unknown | Promise<unknown>;

const handlers: Partial<Record<Method, Handler>> = {
  [Method.PING]: () => handlePing(),
  [Method.WORLD_GET]: () => handleWorldGet(),
  [Method.DOCUMENTS_LIST]: (params) =>
    handleDocumentsList(params as Parameters<typeof handleDocumentsList>[0]),
  [Method.DOCUMENTS_GET]: (params) =>
    handleDocumentsGet(params as Parameters<typeof handleDocumentsGet>[0]),
  [Method.DOCUMENTS_SEARCH]: (params) =>
    handleDocumentsSearch(params as Parameters<typeof handleDocumentsSearch>[0]),
  [Method.DOCUMENTS_CREATE]: (params) =>
    handleDocumentsCreate(params as Parameters<typeof handleDocumentsCreate>[0]),
  [Method.DOCUMENTS_UPDATE]: (params) =>
    handleDocumentsUpdate(params as Parameters<typeof handleDocumentsUpdate>[0]),
  [Method.DOCUMENTS_DELETE]: (params, state) =>
    handleDocumentsDelete(
      params as Parameters<typeof handleDocumentsDelete>[0],
      state,
    ),
  [Method.EMBEDDED_CREATE]: (params) =>
    handleEmbeddedCreate(params as Parameters<typeof handleEmbeddedCreate>[0]),
  [Method.EMBEDDED_UPDATE]: (params) =>
    handleEmbeddedUpdate(params as Parameters<typeof handleEmbeddedUpdate>[0]),
  [Method.EMBEDDED_DELETE]: (params, state) =>
    handleEmbeddedDelete(
      params as Parameters<typeof handleEmbeddedDelete>[0],
      state,
    ),
  [Method.COMPENDIUM_LIST]: (params) =>
    handleCompendiumList(params as Parameters<typeof handleCompendiumList>[0]),
  [Method.COMPENDIUM_SEARCH]: (params) =>
    handleCompendiumSearch(
      params as Parameters<typeof handleCompendiumSearch>[0],
    ),
  [Method.COMPENDIUM_IMPORT]: (params) =>
    handleCompendiumImport(
      params as Parameters<typeof handleCompendiumImport>[0],
    ),
  [Method.FOLDERS_CREATE]: (params) =>
    handleFoldersCreate(params as Parameters<typeof handleFoldersCreate>[0]),
  [Method.FOLDERS_MOVE]: (params) =>
    handleFoldersMove(params as Parameters<typeof handleFoldersMove>[0]),
  [Method.MESSAGES_CREATE]: (params) =>
    handleMessagesCreate(params as Parameters<typeof handleMessagesCreate>[0]),
  [Method.SCENE_ACTIVE]: () => handleSceneActive(),
  [Method.SCENE_ACTIVATE]: (params) =>
    handleSceneActivate(params as Parameters<typeof handleSceneActivate>[0]),
  [Method.TOKEN_PLACE]: (params) =>
    handleTokenPlace(params as Parameters<typeof handleTokenPlace>[0]),
  [Method.TOKEN_UPDATE]: (params) =>
    handleTokenUpdate(params as Parameters<typeof handleTokenUpdate>[0]),
  [Method.DICE_ROLL]: (params) =>
    handleDiceRoll(params as Parameters<typeof handleDiceRoll>[0]),
  [Method.TABLE_DRAW]: (params) =>
    handleTableDraw(params as Parameters<typeof handleTableDraw>[0]),
  [Method.COMBAT_CREATE]: (params) =>
    handleCombatCreate(params as Parameters<typeof handleCombatCreate>[0]),
  [Method.COMBAT_ADD]: (params) =>
    handleCombatAdd(params as Parameters<typeof handleCombatAdd>[0]),
  [Method.COMBAT_ROLL_INITIATIVE]: (params) =>
    handleCombatRollInitiative(
      params as Parameters<typeof handleCombatRollInitiative>[0],
    ),
  [Method.COMBAT_ADVANCE]: (params) =>
    handleCombatAdvance(params as Parameters<typeof handleCombatAdvance>[0]),
};

export function registerHandler(method: Method, handler: Handler): void {
  handlers[method] = handler;
}

export async function dispatch(
  rawMethod: string,
  rawParams: unknown,
  state: PermissionState,
): Promise<unknown> {
  const methodParse = methodSchema.safeParse(rawMethod);
  if (!methodParse.success) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `Unknown method '${rawMethod}'`,
    );
  }
  const method = methodParse.data;
  assertAllowed(method, state);

  const schema = paramSchemas[method];
  let params: unknown = rawParams;
  if (schema) {
    try {
      params = schema.parse(rawParams ?? {});
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BridgeError(
          ErrorCode.BAD_REQUEST,
          `Invalid params for '${method}': ${err.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
        );
      }
      throw err;
    }
  }

  const handler = handlers[method];
  if (!handler) {
    throw new BridgeError(
      ErrorCode.INTERNAL,
      `No handler registered for method '${method}'`,
    );
  }
  return await handler(params, state);
}

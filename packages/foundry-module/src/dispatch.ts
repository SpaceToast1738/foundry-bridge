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
  handleDocumentsDuplicate,
  handleDocumentsGet,
  handleDocumentsList,
  handleDocumentsUpdate,
} from "./handlers/documents.js";
import { handleDocumentsSearch } from "./handlers/search.js";
import { handleTableCreate, handleTableAddResults } from "./handlers/tables.js";
import {
  handlePlaylistPlay,
  handlePlaylistPlaySound,
  handlePlaylistStop,
} from "./handlers/audio.js";
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
import { handleMessagesCreate, handleMessagesList } from "./handlers/messages.js";
import {
  handleSceneActivate,
  handleSceneActive,
  handleSceneResetFog,
  handleSceneUpdate,
  handleTokenPlace,
  handleTokenUpdate,
  handleWallsDraw,
} from "./handlers/scenes.js";
import {
  handleDiceRoll,
  handleDiceRollToChat,
  handleTableDraw,
} from "./handlers/dice.js";
import {
  handleCombatAdd,
  handleCombatAdvance,
  handleCombatCreate,
  handleCombatRemove,
  handleCombatRollInitiative,
  handleCombatSetInitiative,
} from "./handlers/combat.js";
import {
  handlePresentPing,
  handlePresentPull,
  handlePresentShow,
} from "./handlers/present.js";
import { handleMacroExecute } from "./handlers/macro.js";
import { handleStatusGet } from "./handlers/status.js";
import {
  handleCardsDeal,
  handleCardsDraw,
  handleCardsPass,
  handleCardsReset,
  handleCardsShuffle,
} from "./handlers/cards.js";
import { handleTimeAdvance, handleTimeSet } from "./handlers/time.js";
import { handleFilesBrowse, handleFilesUpload } from "./handlers/files.js";
import {
  handleActorApplyDamage,
  handleActorApplyHealing,
  handleActorAssign,
  handleActorCreate,
  handleActorGrantItem,
  handleActorRollData,
  handleActorToggleCondition,
  handleConditionsList,
} from "./handlers/actors.js";
import {
  handleDnd5eActorSummary,
  handleDnd5eApplyDamage,
  handleDnd5eApplyHealing,
  handleDnd5eRest,
  handleDnd5eRoll,
} from "./systems/dnd5e.js";

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
  [Method.FILES_BROWSE]: (params) =>
    handleFilesBrowse(params as Parameters<typeof handleFilesBrowse>[0]),
  [Method.FILES_UPLOAD]: (params) =>
    handleFilesUpload(params as Parameters<typeof handleFilesUpload>[0]),
  [Method.ACTOR_CREATE]: (params) =>
    handleActorCreate(params as Parameters<typeof handleActorCreate>[0]),
  [Method.ACTOR_GRANT_ITEM]: (params) =>
    handleActorGrantItem(params as Parameters<typeof handleActorGrantItem>[0]),
  [Method.CONDITIONS_LIST]: () => handleConditionsList(),
  [Method.ACTOR_TOGGLE_CONDITION]: (params) =>
    handleActorToggleCondition(
      params as Parameters<typeof handleActorToggleCondition>[0],
    ),
  [Method.ACTOR_ROLL_DATA]: (params) =>
    handleActorRollData(params as Parameters<typeof handleActorRollData>[0]),
  [Method.ACTOR_ASSIGN]: (params) =>
    handleActorAssign(params as Parameters<typeof handleActorAssign>[0]),
  [Method.ACTOR_APPLY_DAMAGE]: (params) =>
    handleActorApplyDamage(params as Parameters<typeof handleActorApplyDamage>[0]),
  [Method.ACTOR_APPLY_HEALING]: (params) =>
    handleActorApplyHealing(params as Parameters<typeof handleActorApplyHealing>[0]),
  [Method.DND5E_APPLY_DAMAGE]: (params) =>
    handleDnd5eApplyDamage(params as Parameters<typeof handleDnd5eApplyDamage>[0]),
  [Method.DND5E_APPLY_HEALING]: (params) =>
    handleDnd5eApplyHealing(params as Parameters<typeof handleDnd5eApplyHealing>[0]),
  [Method.DND5E_ROLL]: (params) =>
    handleDnd5eRoll(params as Parameters<typeof handleDnd5eRoll>[0]),
  [Method.DND5E_REST]: (params) =>
    handleDnd5eRest(params as Parameters<typeof handleDnd5eRest>[0]),
  [Method.DND5E_ACTOR_SUMMARY]: (params) =>
    handleDnd5eActorSummary(params as Parameters<typeof handleDnd5eActorSummary>[0]),
  [Method.TABLE_CREATE]: (params) =>
    handleTableCreate(params as Parameters<typeof handleTableCreate>[0]),
  [Method.TABLE_ADD_RESULTS]: (params) =>
    handleTableAddResults(params as Parameters<typeof handleTableAddResults>[0]),
  [Method.PLAYLIST_PLAY]: (params) =>
    handlePlaylistPlay(params as Parameters<typeof handlePlaylistPlay>[0]),
  [Method.PLAYLIST_STOP]: (params) =>
    handlePlaylistStop(params as Parameters<typeof handlePlaylistStop>[0]),
  [Method.PLAYLIST_PLAY_SOUND]: (params) =>
    handlePlaylistPlaySound(params as Parameters<typeof handlePlaylistPlaySound>[0]),
  [Method.MESSAGES_LIST]: (params) =>
    handleMessagesList(params as Parameters<typeof handleMessagesList>[0]),
  [Method.DICE_ROLL_TO_CHAT]: (params) =>
    handleDiceRollToChat(params as Parameters<typeof handleDiceRollToChat>[0]),
  [Method.DOCUMENTS_DUPLICATE]: (params) =>
    handleDocumentsDuplicate(params as Parameters<typeof handleDocumentsDuplicate>[0]),
  [Method.PRESENT_SHOW]: (params) =>
    handlePresentShow(params as Parameters<typeof handlePresentShow>[0]),
  [Method.PRESENT_PULL]: (params) =>
    handlePresentPull(params as Parameters<typeof handlePresentPull>[0]),
  [Method.PRESENT_PING]: (params) =>
    handlePresentPing(params as Parameters<typeof handlePresentPing>[0]),
  [Method.SCENE_UPDATE]: (params) =>
    handleSceneUpdate(params as Parameters<typeof handleSceneUpdate>[0]),
  [Method.SCENE_RESET_FOG]: (params) =>
    handleSceneResetFog(params as Parameters<typeof handleSceneResetFog>[0]),
  [Method.COMBAT_SET_INITIATIVE]: (params) =>
    handleCombatSetInitiative(params as Parameters<typeof handleCombatSetInitiative>[0]),
  [Method.COMBAT_REMOVE]: (params) =>
    handleCombatRemove(params as Parameters<typeof handleCombatRemove>[0]),
  [Method.MACRO_EXECUTE]: (params) =>
    handleMacroExecute(params as Parameters<typeof handleMacroExecute>[0]),
  [Method.STATUS_GET]: () => handleStatusGet(),
  [Method.CARDS_DEAL]: (params) =>
    handleCardsDeal(params as Parameters<typeof handleCardsDeal>[0]),
  [Method.CARDS_DRAW]: (params) =>
    handleCardsDraw(params as Parameters<typeof handleCardsDraw>[0]),
  [Method.CARDS_SHUFFLE]: (params) =>
    handleCardsShuffle(params as Parameters<typeof handleCardsShuffle>[0]),
  [Method.CARDS_PASS]: (params) =>
    handleCardsPass(params as Parameters<typeof handleCardsPass>[0]),
  [Method.CARDS_RESET]: (params) =>
    handleCardsReset(params as Parameters<typeof handleCardsReset>[0]),
  [Method.TIME_ADVANCE]: (params) =>
    handleTimeAdvance(params as Parameters<typeof handleTimeAdvance>[0]),
  [Method.TIME_SET]: (params) =>
    handleTimeSet(params as Parameters<typeof handleTimeSet>[0]),
  [Method.WALLS_DRAW]: (params) =>
    handleWallsDraw(params as Parameters<typeof handleWallsDraw>[0]),
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

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
  handleFoldersCreate,
  handleFoldersMove,
} from "./handlers/folders.js";

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
  [Method.FOLDERS_CREATE]: (params) =>
    handleFoldersCreate(params as Parameters<typeof handleFoldersCreate>[0]),
  [Method.FOLDERS_MOVE]: (params) =>
    handleFoldersMove(params as Parameters<typeof handleFoldersMove>[0]),
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

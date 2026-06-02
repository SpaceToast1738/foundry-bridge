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
  [Method.DOCUMENTS_CREATE]: (params) =>
    handleDocumentsCreate(params as Parameters<typeof handleDocumentsCreate>[0]),
  [Method.DOCUMENTS_UPDATE]: (params) =>
    handleDocumentsUpdate(params as Parameters<typeof handleDocumentsUpdate>[0]),
  [Method.DOCUMENTS_DELETE]: (params, state) =>
    handleDocumentsDelete(
      params as Parameters<typeof handleDocumentsDelete>[0],
      state,
    ),
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

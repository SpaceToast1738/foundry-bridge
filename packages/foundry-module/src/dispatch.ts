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

export type Handler = (params: unknown) => unknown | Promise<unknown>;

const handlers: Partial<Record<Method, Handler>> = {
  [Method.PING]: () => handlePing(),
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
  return await handler(params);
}

import { z } from "zod";

export const ErrorCode = {
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  INTERNAL: "INTERNAL",
  TIMEOUT: "TIMEOUT",
  UNAVAILABLE: "UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const errorCodeSchema = z.enum([
  ErrorCode.FORBIDDEN,
  ErrorCode.NOT_FOUND,
  ErrorCode.BAD_REQUEST,
  ErrorCode.INTERNAL,
  ErrorCode.TIMEOUT,
  ErrorCode.UNAVAILABLE,
]);

export const errorPayloadSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
});

export type ErrorPayload = z.infer<typeof errorPayloadSchema>;

export class BridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BridgeError";
  }

  toPayload(): ErrorPayload {
    return { code: this.code, message: this.message };
  }
}

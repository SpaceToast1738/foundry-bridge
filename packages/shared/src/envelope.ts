import { z } from "zod";
import { errorPayloadSchema } from "./errors.js";
import { methodSchema } from "./methods.js";

export const requestSchema = z.object({
  id: z.string().min(1),
  method: methodSchema,
  params: z.unknown(),
});

export type Request = z.infer<typeof requestSchema>;

export const responseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      id: z.string().min(1),
      ok: z.literal(true),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      ok: z.literal(false),
      error: errorPayloadSchema,
    })
    .strict(),
]);

export type Response = z.infer<typeof responseSchema>;

export type OkResponse = Extract<Response, { ok: true }>;
export type ErrResponse = Extract<Response, { ok: false }>;

export function encode(value: Request | Response): string {
  return JSON.stringify(value);
}

export function decodeRequest(input: unknown): Request {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  return requestSchema.parse(raw);
}

export function decodeResponse(input: unknown): Response {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  return responseSchema.parse(raw);
}

import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import { docToObject, findInCollection, getCollection } from "../collections.js";

interface ChatMessageClass {
  create(data: Record<string, unknown>): Promise<unknown>;
}

function getChatMessageClass(): ChatMessageClass {
  const cls = (globalThis as Record<string, unknown>).ChatMessage as
    | ChatMessageClass
    | undefined;
  if (!cls || typeof cls.create !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "ChatMessage document class is not loaded",
    );
  }
  return cls;
}

function gmUserIds(): string[] {
  const users = getCollection("users");
  if (!users) return [];
  return users.contents
    .map((u) => u as { id?: string; _id?: string; isGM?: boolean })
    .filter((u) => u.isGM)
    .map((u) => u.id ?? u._id)
    .filter((id): id is string => typeof id === "string");
}

export async function handleMessagesCreate(
  params: ParamsFor<typeof Method.MESSAGES_CREATE>,
): Promise<Record<string, unknown>> {
  const cls = getChatMessageClass();

  const data: Record<string, unknown> = { content: params.content };

  if (params.whisper === "gm") {
    data.whisper = gmUserIds();
  } else if (Array.isArray(params.whisper)) {
    const users = getCollection("users");
    const ids: string[] = [];
    for (const ref of params.whisper) {
      const raw = users && findInCollection(users, ref);
      if (!raw) {
        throw new BridgeError(
          ErrorCode.NOT_FOUND,
          `User not found by ref ${JSON.stringify(ref)}`,
        );
      }
      const obj = docToObject(raw);
      const id = obj._id ?? obj.id;
      if (typeof id === "string") ids.push(id);
    }
    data.whisper = ids;
  }

  if (params.blind !== undefined) data.blind = params.blind;
  if (params.speaker_alias !== undefined) {
    data.speaker = { alias: params.speaker_alias };
  }

  const created = await cls.create(data);
  return docToObject(created);
}

import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  type DocRef,
  docToObject,
  findInCollection,
  getCollection,
  getDocumentClass,
} from "../collections.js";

interface ActorDoc {
  id?: string;
  getRollData(): Record<string, unknown>;
  toggleStatusEffect(id: string, options?: { active?: boolean }): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  createEmbeddedDocuments(name: string, data: Record<string, unknown>[]): Promise<unknown[]>;
  applyDamage?: (...args: unknown[]) => Promise<unknown>;
}

function resolveActor(ref: DocRef): ActorDoc {
  const actors = getCollection("actors");
  const raw = actors && findInCollection(actors, ref);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Actor not found by ref ${JSON.stringify(ref)}`,
    );
  }
  return raw as ActorDoc;
}

export async function handleActorCreate(
  params: ParamsFor<typeof Method.ACTOR_CREATE>,
): Promise<Record<string, unknown>> {
  const cls = getDocumentClass("Actor");
  if (!cls) {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Actor document class is not loaded");
  }
  const data: Record<string, unknown> = {
    ...(params.data ?? {}),
    name: params.name,
  };
  if (params.type !== undefined) data.type = params.type;
  if (params.folder !== undefined) data.folder = params.folder;
  const created = await cls.createDocuments([data]);
  if (created.length === 0) {
    throw new BridgeError(ErrorCode.INTERNAL, "Actor creation returned nothing");
  }
  return docToObject(created[0]);
}

interface PackLike {
  getIndex(): Promise<{ contents: Record<string, unknown>[] }>;
  getDocument(id: string): Promise<unknown>;
}

export async function handleActorGrantItem(
  params: ParamsFor<typeof Method.ACTOR_GRANT_ITEM>,
): Promise<Record<string, unknown>> {
  const fromPack = Boolean(params.pack && params.entry);
  const fromInline = Boolean(params.item);
  if (fromPack === fromInline) {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      "Provide exactly one source: (pack + entry) or item",
    );
  }
  const actor = resolveActor(params.actor);

  let itemData: Record<string, unknown>;
  if (fromPack) {
    const packs = game.packs as { get(id: string): unknown } | undefined;
    const pack = packs?.get(params.pack as string) as PackLike | undefined;
    if (!pack) {
      throw new BridgeError(ErrorCode.NOT_FOUND, `Compendium pack '${params.pack}' not found`);
    }
    const index = await pack.getIndex();
    const ref = params.entry as DocRef;
    const wantId = ref._id ?? ref.id;
    const entry = index.contents.find((e) =>
      wantId ? e._id === wantId : e.name === ref.name,
    );
    if (!entry) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `Pack entry not found by ref ${JSON.stringify(params.entry)}`,
      );
    }
    const doc = await pack.getDocument(entry._id as string);
    itemData = docToObject(doc);
    delete itemData._id;
  } else {
    itemData = { ...(params.item as Record<string, unknown>) };
  }

  const created = await actor.createEmbeddedDocuments("Item", [itemData]);
  return {
    actor: actor.id,
    count: created.length,
    items: created.map(docToObject),
  };
}

export function handleConditionsList(): { count: number; conditions: Record<string, unknown>[] } {
  const raw = (CONFIG as { statusEffects?: unknown }).statusEffects;
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const conditions = list.map((s) => ({
    id: s.id,
    name: s.name ?? s.label,
    img: s.img ?? s.icon,
  }));
  return { count: conditions.length, conditions };
}

export async function handleActorToggleCondition(
  params: ParamsFor<typeof Method.ACTOR_TOGGLE_CONDITION>,
): Promise<Record<string, unknown>> {
  const actor = resolveActor(params.actor);
  if (typeof actor.toggleStatusEffect !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "This Foundry version/actor does not support toggleStatusEffect",
    );
  }
  const result = await actor.toggleStatusEffect(params.condition, {
    active: params.active,
  });
  return { actor: actor.id, condition: params.condition, applied: result !== false };
}

export function handleActorRollData(
  params: ParamsFor<typeof Method.ACTOR_ROLL_DATA>,
): Record<string, unknown> {
  const actor = resolveActor(params.actor);
  return actor.getRollData();
}

export async function handleActorAssign(
  params: ParamsFor<typeof Method.ACTOR_ASSIGN>,
): Promise<Record<string, unknown>> {
  const actor = resolveActor(params.actor);
  const users = getCollection("users");
  const userRaw = users && findInCollection(users, params.user);
  if (!userRaw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `User not found by ref ${JSON.stringify(params.user)}`,
    );
  }
  const userId = docToObject(userRaw)._id;
  if (typeof userId !== "string") {
    throw new BridgeError(ErrorCode.INTERNAL, "User missing _id");
  }
  const level = params.level ?? 3;
  const current = (docToObject(actor).ownership as Record<string, unknown>) ?? {};
  await actor.update({ ownership: { ...current, [userId]: level } });
  return { actor: actor.id, user: userId, level };
}

async function applySignedDamage(
  ref: DocRef,
  amount: number,
  label: string,
): Promise<Record<string, unknown>> {
  const actor = resolveActor(ref);
  if (typeof actor.applyDamage !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "This game system's actor has no applyDamage(); adjust HP with modify_document on the system HP field instead",
    );
  }
  try {
    await actor.applyDamage(amount);
  } catch (err) {
    throw new BridgeError(
      ErrorCode.INTERNAL,
      `applyDamage failed: ${(err as Error).message}`,
    );
  }
  return { actor: actor.id, [label]: Math.abs(amount) };
}

export function handleActorApplyDamage(
  params: ParamsFor<typeof Method.ACTOR_APPLY_DAMAGE>,
): Promise<Record<string, unknown>> {
  return applySignedDamage(params.actor, Math.abs(params.amount), "damage");
}

export function handleActorApplyHealing(
  params: ParamsFor<typeof Method.ACTOR_APPLY_HEALING>,
): Promise<Record<string, unknown>> {
  return applySignedDamage(params.actor, -Math.abs(params.amount), "healing");
}

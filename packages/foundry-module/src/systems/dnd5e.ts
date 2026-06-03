import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  type DocRef,
  findInCollection,
  getCollection,
} from "../collections.js";

/** Guard: dnd5e_* tools only work when the world runs the dnd5e system. */
function assertDnd5e(): void {
  if (game.system?.id !== "dnd5e") {
    throw new BridgeError(
      ErrorCode.BAD_REQUEST,
      `dnd5e_* tools require the dnd5e system; this world runs '${game.system?.id ?? "unknown"}'`,
    );
  }
}

interface Dnd5eActor {
  id?: string;
  name?: string;
  system?: Record<string, unknown>;
  applyDamage?: (...args: unknown[]) => Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  shortRest?: (config?: Record<string, unknown>) => Promise<unknown>;
  longRest?: (config?: Record<string, unknown>) => Promise<unknown>;
  rollSavingThrow?: (...args: unknown[]) => Promise<unknown>;
  rollAbilitySave?: (...args: unknown[]) => Promise<unknown>;
  rollAbilityCheck?: (...args: unknown[]) => Promise<unknown>;
  rollAbilityTest?: (...args: unknown[]) => Promise<unknown>;
  rollSkill?: (...args: unknown[]) => Promise<unknown>;
  rollDeathSave?: (...args: unknown[]) => Promise<unknown>;
}

function resolveActor(ref: DocRef): Dnd5eActor {
  const actors = getCollection("actors");
  const raw = actors && findInCollection(actors, ref);
  if (!raw) {
    throw new BridgeError(ErrorCode.NOT_FOUND, `Actor not found by ref ${JSON.stringify(ref)}`);
  }
  return raw as Dnd5eActor;
}

function hp(actor: Dnd5eActor): Record<string, unknown> | undefined {
  const attrs = actor.system?.attributes as { hp?: Record<string, unknown> } | undefined;
  return attrs?.hp;
}

/** dnd5e applyDamage takes [{value,type}] in v4+; fall back to (amount, multiplier). */
async function applyDamage(
  actor: Dnd5eActor,
  value: number,
  type: string,
  multiplier: number,
): Promise<void> {
  if (typeof actor.applyDamage !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Actor has no applyDamage()");
  }
  try {
    await actor.applyDamage([{ value, type }], { multiplier });
  } catch {
    await actor.applyDamage(value, multiplier);
  }
}

export async function handleDnd5eApplyDamage(
  params: ParamsFor<typeof Method.DND5E_APPLY_DAMAGE>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  await applyDamage(actor, Math.abs(params.amount), params.type ?? "", params.multiplier ?? 1);
  return { actor: actor.id, damage: Math.abs(params.amount), type: params.type ?? "untyped", hp: hp(actor) };
}

export async function handleDnd5eApplyHealing(
  params: ParamsFor<typeof Method.DND5E_APPLY_HEALING>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const type = params.temp ? "temphp" : "healing";
  await applyDamage(actor, Math.abs(params.amount), type, 1);
  return { actor: actor.id, [params.temp ? "tempHP" : "healing"]: Math.abs(params.amount), hp: hp(actor) };
}

function rollTotal(result: unknown): number | undefined {
  const r = Array.isArray(result) ? result[0] : result;
  const t = (r as { total?: unknown })?.total;
  return typeof t === "number" ? t : undefined;
}

export async function handleDnd5eRoll(
  params: ParamsFor<typeof Method.DND5E_ROLL>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const key = params.key;
  let result: unknown;

  const call = async (
    v4: ((...args: unknown[]) => Promise<unknown>) | undefined,
    v3: ((...args: unknown[]) => Promise<unknown>) | undefined,
    cfg: Record<string, unknown>,
    positional: string | undefined,
  ): Promise<unknown> => {
    if (typeof v4 === "function") {
      try {
        // dnd5e v4+ signature is (config, dialog, message). Skip the dialog so
        // it can't hang waiting for a click in the headless browser, and don't
        // post a chat card (the caller can use post_chat_message).
        return await v4(cfg, { configure: false }, { create: false });
      } catch {
        /* fall through to the v3 signature */
      }
    }
    if (typeof v3 === "function") {
      // dnd5e v3 signature is (id?, { fastForward, chatMessage }).
      const opts = { fastForward: true, chatMessage: false };
      return positional !== undefined ? v3(positional, opts) : v3(opts);
    }
    throw new BridgeError(ErrorCode.UNAVAILABLE, `dnd5e roll '${params.kind}' is not supported by this actor`);
  };

  switch (params.kind) {
    case "save":
      requireKey(key, "save");
      result = await call(actor.rollSavingThrow?.bind(actor), actor.rollAbilitySave?.bind(actor), { ability: key }, key);
      break;
    case "check":
      requireKey(key, "check");
      result = await call(actor.rollAbilityCheck?.bind(actor), actor.rollAbilityTest?.bind(actor), { ability: key }, key);
      break;
    case "skill":
      requireKey(key, "skill");
      result = await call(actor.rollSkill?.bind(actor), actor.rollSkill?.bind(actor), { skill: key }, key);
      break;
    case "death":
      if (typeof actor.rollDeathSave !== "function") {
        throw new BridgeError(ErrorCode.UNAVAILABLE, "rollDeathSave not supported");
      }
      try {
        result = await actor.rollDeathSave({}, { configure: false }, { create: false });
      } catch {
        result = await actor.rollDeathSave({ fastForward: true, chatMessage: false });
      }
      break;
  }
  return { actor: actor.id, kind: params.kind, key: key ?? null, total: rollTotal(result) ?? null };
}

function requireKey(key: string | undefined, kind: string): asserts key is string {
  if (!key) {
    throw new BridgeError(ErrorCode.BAD_REQUEST, `dnd5e roll '${kind}' requires \`key\` (e.g. "dex", "ath")`);
  }
}

export async function handleDnd5eRest(
  params: ParamsFor<typeof Method.DND5E_REST>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const fn = params.type === "long" ? actor.longRest : actor.shortRest;
  if (typeof fn !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, `${params.type}Rest is not supported by this actor`);
  }
  try {
    await fn.call(actor, { dialog: false, chat: false });
  } catch {
    await fn.call(actor, {});
  }
  return { actor: actor.id, rest: params.type, hp: hp(actor) };
}

export function handleDnd5eActorSummary(
  params: ParamsFor<typeof Method.DND5E_ACTOR_SUMMARY>,
): Record<string, unknown> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const sys = (actor.system ?? {}) as {
    attributes?: { hp?: Record<string, unknown>; ac?: { value?: unknown } };
    abilities?: Record<string, { value?: unknown; mod?: unknown }>;
    details?: { level?: unknown; cr?: unknown };
  };
  const abilities: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sys.abilities ?? {})) {
    abilities[k] = { value: v?.value, mod: v?.mod };
  }
  return {
    name: actor.name,
    hp: sys.attributes?.hp,
    ac: sys.attributes?.ac?.value,
    abilities,
    level: sys.details?.level,
    cr: sys.details?.cr,
  };
}

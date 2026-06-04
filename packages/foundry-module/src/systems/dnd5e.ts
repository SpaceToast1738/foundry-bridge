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
  concentration?: { effects?: { size?: number; contents?: unknown[] } };
  endConcentration?: (...args: unknown[]) => Promise<unknown>;
  items?: { contents?: Dnd5eItem[]; get?: (id: string) => Dnd5eItem | undefined };
}

interface Dnd5eItem {
  id?: string;
  _id?: string;
  name?: string;
  use?: (...args: unknown[]) => Promise<unknown>;
  rollAttack?: (...args: unknown[]) => Promise<unknown>;
  rollDamage?: (...args: unknown[]) => Promise<unknown>;
}

function resolveItem(actor: Dnd5eActor, ref: DocRef): Dnd5eItem {
  const items = actor.items;
  const id = ref._id ?? ref.id;
  const found =
    (id && items?.get?.(id)) ||
    (items?.contents ?? []).find((i) =>
      id ? (i.id ?? i._id) === id : i.name === ref.name,
    );
  if (!found) {
    throw new BridgeError(ErrorCode.NOT_FOUND, `Item not found on actor by ref ${JSON.stringify(ref)}`);
  }
  return found;
}

/** Invoke a dnd5e roll method headlessly: v4 (config, dialog, message) with a
 * v3 ({fastForward, chatMessage}) fallback — same shape as handleDnd5eRoll. */
async function invokeHeadless(fn: (...args: unknown[]) => Promise<unknown>): Promise<unknown> {
  try {
    return await fn({}, { configure: false }, { create: false });
  } catch {
    return await fn({ fastForward: true, chatMessage: false });
  }
}

/** Read a (possibly dotted) path off the actor's `system` object. */
function sysPath(actor: Dnd5eActor, path: string): unknown {
  let cur: unknown = actor.system;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function clamp(n: number, min: number, max: number | undefined): number {
  let v = Math.max(min, n);
  if (typeof max === "number") v = Math.min(max, v);
  return v;
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

export async function handleDnd5eSpellSlots(
  params: ParamsFor<typeof Method.DND5E_SPELL_SLOTS>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const key = params.level === "pact" ? "pact" : `spell${params.level}`;
  const base = `system.spells.${key}`;
  const value = Number(sysPath(actor, `spells.${key}.value`) ?? 0);
  const max = Number(sysPath(actor, `spells.${key}.max`) ?? 0);
  const amount = params.amount ?? 1;
  let next: number;
  switch (params.action) {
    case "use":
      next = clamp(value - amount, 0, max || undefined);
      break;
    case "recover":
      next = clamp(value + amount, 0, max || undefined);
      break;
    case "set":
      next = clamp(amount, 0, max || undefined);
      break;
  }
  await actor.update({ [`${base}.value`]: next });
  return { actor: actor.id, level: params.level, value: next, max };
}

export async function handleDnd5eCurrency(
  params: ParamsFor<typeof Method.DND5E_CURRENCY>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const update: Record<string, unknown> = {};
  const result: Record<string, number> = {};
  for (const [coin, delta] of Object.entries(params.changes)) {
    if (typeof delta !== "number") continue;
    const current = Number(sysPath(actor, `currency.${coin}`) ?? 0);
    const next = params.mode === "set" ? delta : current + delta;
    update[`system.currency.${coin}`] = Math.max(0, next);
    result[coin] = Math.max(0, next);
  }
  await actor.update(update);
  return { actor: actor.id, currency: result };
}

export async function handleDnd5eAwardXp(
  params: ParamsFor<typeof Method.DND5E_AWARD_XP>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const current = Number(sysPath(actor, "details.xp.value") ?? 0);
  const threshold = sysPath(actor, "details.xp.max");
  const next = Math.max(0, current + params.amount);
  await actor.update({ "system.details.xp.value": next });
  return {
    actor: actor.id,
    xp: next,
    threshold: typeof threshold === "number" ? threshold : null,
    levelUpAvailable: typeof threshold === "number" ? next >= threshold : null,
  };
}

export async function handleDnd5eHitDice(
  params: ParamsFor<typeof Method.DND5E_HIT_DICE>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const value = sysPath(actor, "attributes.hd.value");
  const max = sysPath(actor, "attributes.hd.max");
  if (typeof value !== "number") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "This actor/dnd5e version doesn't expose system.attributes.hd.value; manage hit dice on the class item via modify_document",
    );
  }
  const amount = params.amount ?? 1;
  const next = clamp(
    params.action === "spend" ? value - amount : value + amount,
    0,
    typeof max === "number" ? max : undefined,
  );
  await actor.update({ "system.attributes.hd.value": next });
  return { actor: actor.id, hitDice: next, max: typeof max === "number" ? max : null };
}

export async function handleDnd5eDeathSaves(
  params: ParamsFor<typeof Method.DND5E_DEATH_SAVES>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const update: Record<string, unknown> = {};
  if (params.successes !== undefined) update["system.attributes.death.success"] = params.successes;
  if (params.failures !== undefined) update["system.attributes.death.failure"] = params.failures;
  await actor.update(update);
  return {
    actor: actor.id,
    death: {
      success: params.successes ?? sysPath(actor, "attributes.death.success"),
      failure: params.failures ?? sysPath(actor, "attributes.death.failure"),
    },
  };
}

export async function handleDnd5eConcentration(
  params: ParamsFor<typeof Method.DND5E_CONCENTRATION>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const effects = actor.concentration?.effects;
  const count = effects?.size ?? effects?.contents?.length ?? 0;
  if (params.action === "check") {
    return { actor: actor.id, concentrating: count > 0, count };
  }
  // break
  if (typeof actor.endConcentration !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "This dnd5e version doesn't expose actor.endConcentration(); remove the concentration ActiveEffect with delete_embedded",
    );
  }
  await actor.endConcentration();
  return { actor: actor.id, concentrating: false, broke: count };
}

export async function handleDnd5eUseItem(
  params: ParamsFor<typeof Method.DND5E_USE_ITEM>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const item = resolveItem(actor, params.item);
  if (typeof item.use !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "This item/dnd5e version does not support use()");
  }
  // Headless: suppress the use dialog and the chat card.
  try {
    await item.use({}, { configure: false }, { create: false });
  } catch {
    await item.use({ configureDialog: false, createMessage: false });
  }
  return { actor: actor.id, item: item.id ?? item._id, used: true };
}

export async function handleDnd5eItemRoll(
  params: ParamsFor<typeof Method.DND5E_ITEM_ROLL>,
): Promise<Record<string, unknown>> {
  assertDnd5e();
  const actor = resolveActor(params.actor);
  const item = resolveItem(actor, params.item);
  const fn = params.kind === "attack" ? item.rollAttack : item.rollDamage;
  if (typeof fn !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `This item/dnd5e version does not expose roll${params.kind === "attack" ? "Attack" : "Damage"}(); ` +
        "newer dnd5e routes rolls through item Activities — use dnd5e_use_item instead",
    );
  }
  const result = await invokeHeadless(fn.bind(item));
  return { actor: actor.id, item: item.id ?? item._id, kind: params.kind, total: rollTotal(result) ?? null };
}

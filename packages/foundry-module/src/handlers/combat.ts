import {
  BridgeError,
  ErrorCode,
  Method,
  Timeout,
  withTimeout,
  type ParamsFor,
} from "@foundry-bridge/shared";
import {
  type DocRef,
  findInCollection,
  getCollection,
} from "../collections.js";

interface ActorLike {
  applyDamage?: (...args: unknown[]) => Promise<unknown>;
  toggleStatusEffect?: (id: string, options?: Record<string, unknown>) => Promise<unknown>;
}
interface CombatantDoc {
  id?: string;
  _id?: string;
  name?: string;
  initiative?: number | null;
  tokenId?: string;
  actor?: ActorLike;
}
interface CombatDoc {
  id?: string;
  round?: number;
  turn?: number;
  scene?: { id?: string };
  combatants?: { contents?: CombatantDoc[]; get?: (id: string) => CombatantDoc | undefined };
  createEmbeddedDocuments(name: string, data: Record<string, unknown>[]): Promise<unknown[]>;
  updateEmbeddedDocuments(name: string, updates: Record<string, unknown>[]): Promise<unknown[]>;
  rollAll(): Promise<unknown>;
  rollInitiative(ids: string[]): Promise<unknown>;
  startCombat(): Promise<unknown>;
  nextTurn(): Promise<unknown>;
  previousTurn(): Promise<unknown>;
  nextRound(): Promise<unknown>;
  previousRound(): Promise<unknown>;
  endCombat(): Promise<unknown>;
  delete?: () => Promise<unknown>;
  setInitiative(combatantId: string, value: number): Promise<unknown>;
  deleteEmbeddedDocuments(name: string, ids: string[]): Promise<unknown[]>;
  activate?(): Promise<unknown>;
}

function findCombatant(combat: CombatDoc, id: string): CombatantDoc {
  const cb =
    combat.combatants?.get?.(id) ??
    (combat.combatants?.contents ?? []).find((c) => (c.id ?? c._id) === id);
  if (!cb) {
    throw new BridgeError(ErrorCode.NOT_FOUND, `Combatant ${id} not found in this combat`);
  }
  return cb;
}
interface CombatCtor {
  create(data: Record<string, unknown>): Promise<CombatDoc>;
}

function getCombatClass(): CombatCtor {
  const cls = (globalThis as Record<string, unknown>).Combat as CombatCtor | undefined;
  if (!cls || typeof cls.create !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Combat class is not loaded");
  }
  return cls;
}

function activeCombat(): CombatDoc | undefined {
  return (game.combat as CombatDoc | undefined) ?? undefined;
}

function resolveCombat(ref: DocRef | undefined): CombatDoc {
  if (ref) {
    const combats = getCollection("combats");
    const raw = combats && findInCollection(combats, ref);
    if (!raw) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `Combat not found by ref ${JSON.stringify(ref)}`,
      );
    }
    return raw as CombatDoc;
  }
  const active = activeCombat();
  if (!active) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      "No active combat; create one or pass `combat`",
    );
  }
  return active;
}

function combatState(c: CombatDoc): Record<string, unknown> {
  return {
    _id: c.id,
    round: c.round,
    turn: c.turn,
    combatants: (c.combatants?.contents ?? []).map((cb) => ({
      _id: cb.id ?? cb._id,
      name: cb.name,
      initiative: cb.initiative ?? null,
      tokenId: cb.tokenId,
    })),
  };
}

function activeSceneId(): string | undefined {
  const scenes = getCollection("scenes") as { active?: { id?: string } } | undefined;
  return scenes?.active?.id;
}

export async function handleCombatCreate(
  params: ParamsFor<typeof Method.COMBAT_CREATE>,
): Promise<Record<string, unknown>> {
  let sceneId: string | undefined;
  if (params.scene) {
    const scenes = getCollection("scenes");
    const raw = scenes && findInCollection(scenes, params.scene);
    sceneId = raw ? ((raw as { id?: string }).id ?? undefined) : undefined;
    if (!sceneId) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `Scene not found by ref ${JSON.stringify(params.scene)}`,
      );
    }
  } else {
    sceneId = activeSceneId();
  }
  const Combat = getCombatClass();
  const combat = await Combat.create({ scene: sceneId });
  if (typeof combat.activate === "function") {
    await withTimeout(
      Promise.resolve(combat.activate()),
      Timeout.ACTIVATE,
      "Activating the new combat did not complete (headless canvas may be unavailable). " +
        "The encounter was created; check get_status. Don't blindly retry.",
    );
  }
  return combatState(combat);
}

export async function handleCombatAdd(
  params: ParamsFor<typeof Method.COMBAT_ADD>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  const sceneId = combat.scene?.id ?? activeSceneId();
  const created = await combat.createEmbeddedDocuments(
    "Combatant",
    params.tokens.map((tokenId) => ({ tokenId, sceneId })),
  );
  if (params.roll_initiative) {
    const ids = created
      .map((c) => (c as CombatantDoc).id ?? (c as CombatantDoc)._id)
      .filter((id): id is string => typeof id === "string");
    if (ids.length) await combat.rollInitiative(ids);
  }
  return combatState(combat);
}

async function damageActor(actor: ActorLike, amount: number, type: string | undefined): Promise<void> {
  if (typeof actor.applyDamage !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "The combatant's actor has no applyDamage()");
  }
  // 5e accepts [{value,type}]; other systems take a scalar. Try typed, fall back.
  try {
    await actor.applyDamage([{ value: amount, type: type ?? "" }], {});
  } catch {
    await actor.applyDamage(amount);
  }
}

export async function handleCombatantDamage(
  params: ParamsFor<typeof Method.COMBATANT_DAMAGE>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  const amount = Math.abs(params.amount);

  const damageOne = async (id: string): Promise<Record<string, unknown>> => {
    const combatant = findCombatant(combat, id);
    if (!combatant.actor) {
      throw new BridgeError(ErrorCode.UNAVAILABLE, `Combatant ${id} has no linked actor`);
    }
    await damageActor(combatant.actor, amount, params.type);
    return { combatant: id, damage: amount, type: params.type ?? "untyped" };
  };

  if (params.combatants && params.combatants.length) {
    const results: Record<string, unknown>[] = [];
    for (const id of params.combatants) results.push(await damageOne(id));
    return { combat: combat.id, results };
  }
  if (!params.combatant) {
    throw new BridgeError(ErrorCode.BAD_REQUEST, "Provide `combatant` or `combatants`");
  }
  const single = await damageOne(params.combatant);
  return { combat: combat.id, ...single };
}

export async function handleCombatantUpdate(
  params: ParamsFor<typeof Method.COMBATANT_UPDATE>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  const update: Record<string, unknown> = { _id: params.combatant };
  if (params.defeated !== undefined) update.defeated = params.defeated;
  if (params.hidden !== undefined) update.hidden = params.hidden;
  if (params.initiative !== undefined) update.initiative = params.initiative;
  const updated = await combat.updateEmbeddedDocuments("Combatant", [update]);
  if (updated.length === 0) {
    throw new BridgeError(ErrorCode.NOT_FOUND, `Combatant ${params.combatant} not found in this combat`);
  }
  return combatState(combat);
}

export async function handleCombatantCondition(
  params: ParamsFor<typeof Method.COMBATANT_CONDITION>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  const combatant = findCombatant(combat, params.combatant);
  const actor = combatant.actor;
  if (!actor || typeof actor.toggleStatusEffect !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "The combatant's actor doesn't support toggleStatusEffect()",
    );
  }
  const options = params.active === undefined ? {} : { active: params.active };
  await actor.toggleStatusEffect(params.condition, options);
  return { combat: combat.id, combatant: params.combatant, condition: params.condition };
}

export async function handleCombatRollInitiative(
  params: ParamsFor<typeof Method.COMBAT_ROLL_INITIATIVE>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  if (!params.combatants || params.combatants === "all") {
    await combat.rollAll();
  } else {
    await combat.rollInitiative(params.combatants);
  }
  return combatState(combat);
}

export async function handleCombatSetInitiative(
  params: ParamsFor<typeof Method.COMBAT_SET_INITIATIVE>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  await combat.setInitiative(params.combatant, params.value);
  return combatState(combat);
}

export async function handleCombatRemove(
  params: ParamsFor<typeof Method.COMBAT_REMOVE>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  await combat.deleteEmbeddedDocuments("Combatant", params.combatants);
  return combatState(combat);
}

export async function handleCombatAdvance(
  params: ParamsFor<typeof Method.COMBAT_ADVANCE>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  switch (params.action) {
    case "start":
      await combat.startCombat();
      break;
    case "next":
      await combat.nextTurn();
      break;
    case "previous":
      await combat.previousTurn();
      break;
    case "next_round":
      await combat.nextRound();
      break;
    case "previous_round":
      await combat.previousRound();
      break;
    case "end":
      // endCombat() pops a confirmation dialog that hangs the headless browser;
      // delete the document directly instead.
      if (typeof combat.delete === "function") await combat.delete();
      else await combat.endCombat();
      return { _id: combat.id, ended: true };
  }
  return combatState(combat);
}

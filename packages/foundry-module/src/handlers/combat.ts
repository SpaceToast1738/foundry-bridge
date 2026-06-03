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

interface CombatantDoc {
  id?: string;
  _id?: string;
  name?: string;
  initiative?: number | null;
  tokenId?: string;
}
interface CombatDoc {
  id?: string;
  round?: number;
  turn?: number;
  scene?: { id?: string };
  combatants?: { contents?: CombatantDoc[] };
  createEmbeddedDocuments(name: string, data: Record<string, unknown>[]): Promise<unknown[]>;
  rollAll(): Promise<unknown>;
  rollInitiative(ids: string[]): Promise<unknown>;
  startCombat(): Promise<unknown>;
  nextTurn(): Promise<unknown>;
  previousTurn(): Promise<unknown>;
  endCombat(): Promise<unknown>;
  activate?(): Promise<unknown>;
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
  if (typeof combat.activate === "function") await combat.activate();
  return combatState(combat);
}

export async function handleCombatAdd(
  params: ParamsFor<typeof Method.COMBAT_ADD>,
): Promise<Record<string, unknown>> {
  const combat = resolveCombat(params.combat);
  const sceneId = combat.scene?.id ?? activeSceneId();
  await combat.createEmbeddedDocuments(
    "Combatant",
    params.tokens.map((tokenId) => ({ tokenId, sceneId })),
  );
  return combatState(combat);
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
    case "end":
      await combat.endCombat();
      return { _id: combat.id, ended: true };
  }
  return combatState(combat);
}

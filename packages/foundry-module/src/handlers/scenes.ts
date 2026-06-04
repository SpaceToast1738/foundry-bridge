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
  docToObject,
  findInCollection,
  getCollection,
} from "../collections.js";

interface SceneDoc {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  tokens?: { size?: number; contents?: unknown[] };
  activate(): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  resetFog?: () => Promise<unknown>;
  createEmbeddedDocuments(name: string, data: Record<string, unknown>[]): Promise<unknown[]>;
  updateEmbeddedDocuments(name: string, updates: Record<string, unknown>[]): Promise<unknown[]>;
}

interface ActorDoc {
  getTokenDocument(
    data?: Record<string, unknown>,
  ): Promise<{ toObject(): Record<string, unknown> }>;
}

function tokenCount(scene: SceneDoc): number {
  const t = scene.tokens;
  if (!t) return 0;
  if (typeof t.size === "number") return t.size;
  return t.contents?.length ?? 0;
}

function sceneDescriptor(scene: SceneDoc, active: boolean): Record<string, unknown> {
  return {
    _id: scene.id,
    name: scene.name,
    active,
    width: scene.width,
    height: scene.height,
    tokens: tokenCount(scene),
  };
}

function getActiveScene(): SceneDoc | undefined {
  const scenes = getCollection("scenes") as { active?: unknown } | undefined;
  return (scenes?.active as SceneDoc | undefined) ?? undefined;
}

function resolveScene(ref: DocRef | undefined): SceneDoc {
  if (ref) {
    const scenes = getCollection("scenes");
    const raw = scenes && findInCollection(scenes, ref);
    if (!raw) {
      throw new BridgeError(
        ErrorCode.NOT_FOUND,
        `Scene not found by ref ${JSON.stringify(ref)}`,
      );
    }
    return raw as SceneDoc;
  }
  const active = getActiveScene();
  if (!active) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      "No active scene; pass `scene` to target one explicitly",
    );
  }
  return active;
}

export function handleSceneActive(): Record<string, unknown> {
  const active = getActiveScene();
  if (!active) {
    throw new BridgeError(ErrorCode.NOT_FOUND, "No active scene");
  }
  return sceneDescriptor(active, true);
}

export async function handleSceneActivate(
  params: ParamsFor<typeof Method.SCENE_ACTIVATE>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.ref);
  await withTimeout(
    Promise.resolve(scene.activate()),
    Timeout.ACTIVATE,
    `Activating scene '${scene.name ?? scene.id}' did not complete — the headless client's canvas may ` +
      "be unavailable (e.g. no scene was ever rendered). Check get_status; don't blindly retry.",
  );
  return sceneDescriptor(scene, true);
}

export async function handleTokenPlace(
  params: ParamsFor<typeof Method.TOKEN_PLACE>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.scene);
  const actors = getCollection("actors");
  const actorRaw = actors && findInCollection(actors, params.actor);
  if (!actorRaw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Actor not found by ref ${JSON.stringify(params.actor)}`,
    );
  }
  const actor = actorRaw as ActorDoc;
  if (typeof actor.getTokenDocument !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "Actor does not support getTokenDocument",
    );
  }

  const overrides: Record<string, unknown> = { x: params.x, y: params.y };
  if (params.hidden !== undefined) overrides.hidden = params.hidden;
  if (params.name !== undefined) overrides.name = params.name;

  const tokenDoc = await actor.getTokenDocument(overrides);
  const created = await withTimeout(
    scene.createEmbeddedDocuments("Token", [tokenDoc.toObject()]),
    Timeout.PLACEABLE,
    `Placing a token on scene '${scene.name ?? scene.id}' did not complete. In the hosted ` +
      "(headless) bridge, tokens should be placed on the active/rendered scene — activate it " +
      "first with activate_scene, and make sure it has a valid grid/dimensions. Do not blindly retry.",
  );
  if (created.length === 0) {
    throw new BridgeError(ErrorCode.INTERNAL, "Token creation returned nothing");
  }
  return docToObject(created[0]);
}

export async function handleSceneUpdate(
  params: ParamsFor<typeof Method.SCENE_UPDATE>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.scene);
  await scene.update(params.updates);
  return sceneDescriptor(scene, scene === getActiveScene());
}

export async function handleSceneResetFog(
  params: ParamsFor<typeof Method.SCENE_RESET_FOG>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params?.scene);
  if (typeof scene.resetFog !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Scene does not support resetFog()");
  }
  await scene.resetFog();
  return { scene: scene.id, fogReset: true };
}

export async function handleWallsDraw(
  params: ParamsFor<typeof Method.WALLS_DRAW>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.scene);
  const wallData = params.segments.map((seg) => {
    const data: Record<string, unknown> = {
      c: [seg.x1, seg.y1, seg.x2, seg.y2],
    };
    if (seg.door !== undefined) data.door = seg.door;
    if (seg.ds !== undefined) data.ds = seg.ds;
    return data;
  });
  const created = await withTimeout(
    scene.createEmbeddedDocuments("Wall", wallData),
    Timeout.PLACEABLE,
    `Creating walls on scene '${scene.name ?? scene.id}' did not complete. In the hosted ` +
      "(headless) bridge, scene placeables should be created on the active/rendered scene — " +
      "activate it first with activate_scene, and make sure it has a valid grid/dimensions. " +
      "Do not blindly retry.",
  );
  return {
    scene: scene.id,
    created: created.length,
    walls: created.map(docToObject),
  };
}

export async function handleTokenUpdate(
  params: ParamsFor<typeof Method.TOKEN_UPDATE>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.scene);
  const updated = await scene.updateEmbeddedDocuments("Token", [
    { ...params.updates, _id: params.token_id },
  ]);
  if (updated.length === 0) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Token ${params.token_id} not found on the scene`,
    );
  }
  return docToObject(updated[0]);
}

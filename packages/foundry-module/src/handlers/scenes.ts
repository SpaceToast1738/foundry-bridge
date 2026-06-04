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
  getDocumentClass,
} from "../collections.js";

interface SceneDoc {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  tokens?: { size?: number; contents?: unknown[] };
  walls?: { get?: (id: string) => { ds?: number } | undefined };
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

export async function handleSceneCreate(
  params: ParamsFor<typeof Method.SCENE_CREATE>,
): Promise<Record<string, unknown>> {
  const cls = getDocumentClass("Scene");
  if (!cls) {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "Scene document class is not loaded");
  }
  // Defaults produce a placeable-READY scene (real grid/dimensions) so the
  // common "create scene then add walls/tokens" flow doesn't hang on a
  // half-initialized scene.
  const data: Record<string, unknown> = {
    name: params.name,
    width: params.width ?? 4000,
    height: params.height ?? 3000,
    padding: params.padding ?? 0.25,
    grid: { type: params.grid_type ?? 1, size: params.grid_size ?? 100 },
  };
  if (params.background) data.background = { src: params.background };
  const created = await cls.createDocuments([data]);
  if (!created.length) {
    throw new BridgeError(ErrorCode.INTERNAL, "Scene creation returned nothing");
  }
  const scene = created[0] as SceneDoc;
  if (params.activate) {
    await withTimeout(
      Promise.resolve(scene.activate()),
      Timeout.ACTIVATE,
      `Activating new scene '${scene.name ?? scene.id}' did not complete (headless canvas). ` +
        "The scene was created; don't blindly retry.",
    );
  }
  return sceneDescriptor(scene, scene === getActiveScene());
}

export async function handleDoorToggle(
  params: ParamsFor<typeof Method.DOOR_TOGGLE>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.scene);
  let ds = params.state;
  if (ds === undefined) {
    const wall = scene.walls?.get?.(params.wall_id);
    const current = typeof wall?.ds === "number" ? wall.ds : 0;
    ds = current === 1 ? 0 : 1; // flip open <-> closed
  }
  const updated = await scene.updateEmbeddedDocuments("Wall", [
    { _id: params.wall_id, ds },
  ]);
  if (updated.length === 0) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Wall ${params.wall_id} not found on the scene`,
    );
  }
  return { scene: scene.id, wall: params.wall_id, ds };
}

export async function handleLightPlace(
  params: ParamsFor<typeof Method.LIGHT_PLACE>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.scene);
  const config: Record<string, unknown> = {};
  if (params.dim !== undefined) config.dim = params.dim;
  if (params.bright !== undefined) config.bright = params.bright;
  if (params.color !== undefined) config.color = params.color;
  const created = await withTimeout(
    scene.createEmbeddedDocuments("AmbientLight", [{ x: params.x, y: params.y, config }]),
    Timeout.PLACEABLE,
    `Placing a light on scene '${scene.name ?? scene.id}' did not complete. Activate the target scene ` +
      "first (placeables need the active/rendered scene). Don't blindly retry.",
  );
  return docToObject(created[0]);
}

export async function handleNotePlace(
  params: ParamsFor<typeof Method.NOTE_PLACE>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.scene);
  const journals = getCollection("journal");
  const journal = journals && findInCollection(journals, params.journal);
  if (!journal) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Journal not found by ref ${JSON.stringify(params.journal)}`,
    );
  }
  const j = journal as { id?: string; _id?: string };
  const entryId = j.id ?? j._id;
  const data: Record<string, unknown> = { x: params.x, y: params.y, entryId };
  if (params.text !== undefined) data.text = params.text;
  if (params.icon_size !== undefined) data.iconSize = params.icon_size;
  const created = await withTimeout(
    scene.createEmbeddedDocuments("Note", [data]),
    Timeout.PLACEABLE,
    `Placing a map note on scene '${scene.name ?? scene.id}' did not complete. Activate the target ` +
      "scene first. Don't blindly retry.",
  );
  return docToObject(created[0]);
}

export async function handleTemplatePlace(
  params: ParamsFor<typeof Method.TEMPLATE_PLACE>,
): Promise<Record<string, unknown>> {
  const scene = resolveScene(params.scene);
  const data: Record<string, unknown> = {
    t: params.t,
    x: params.x,
    y: params.y,
    distance: params.distance,
  };
  if (params.direction !== undefined) data.direction = params.direction;
  if (params.angle !== undefined) data.angle = params.angle;
  if (params.width !== undefined) data.width = params.width;
  const created = await withTimeout(
    scene.createEmbeddedDocuments("MeasuredTemplate", [data]),
    Timeout.PLACEABLE,
    `Placing a measured template on scene '${scene.name ?? scene.id}' did not complete. Activate the ` +
      "target scene first (placeables need the active/rendered scene). Don't blindly retry.",
  );
  return docToObject(created[0]);
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

import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";
import { findInCollection, getCollection } from "../collections.js";

interface ImagePopoutCtor {
  new (src: string, options?: Record<string, unknown>): {
    shareImage?: () => unknown;
    render?: (force?: boolean) => unknown;
  };
}
interface CanvasLike {
  ping?: (point: { x: number; y: number }) => unknown;
}

export async function handlePresentShow(
  params: ParamsFor<typeof Method.PRESENT_SHOW>,
): Promise<Record<string, unknown>> {
  if (params.image) {
    const ImagePopout = (globalThis as Record<string, unknown>).ImagePopout as
      | ImagePopoutCtor
      | undefined;
    if (!ImagePopout) {
      throw new BridgeError(ErrorCode.UNAVAILABLE, "ImagePopout is not available");
    }
    const pop = new ImagePopout(params.image, params.title ? { title: params.title } : {});
    if (typeof pop.shareImage === "function") pop.shareImage();
    else throw new BridgeError(ErrorCode.UNAVAILABLE, "ImagePopout.shareImage is not available");
    return { shown: "image", image: params.image };
  }

  const journals = getCollection("journal");
  const raw = params.journal && journals && findInCollection(journals, params.journal);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Journal not found by ref ${JSON.stringify(params.journal)}`,
    );
  }
  const doc = raw as { id?: string; show?: (...args: unknown[]) => Promise<unknown> };
  if (typeof doc.show !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "This Foundry version doesn't expose JournalEntry#show(); share an image instead",
    );
  }
  await doc.show();
  return { shown: "journal", journal: doc.id };
}

export function handlePresentPull(
  params: ParamsFor<typeof Method.PRESENT_PULL>,
): Record<string, unknown> {
  const scenes = getCollection("scenes");
  const raw = scenes && findInCollection(scenes, params.scene);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Scene not found by ref ${JSON.stringify(params.scene)}`,
    );
  }
  const sceneId = (raw as { id?: string }).id;
  if (!game.socket) {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "game.socket is not available");
  }
  game.socket.emit("pullToScene", sceneId);
  return { pulled: true, scene: sceneId };
}

export function handlePresentPing(
  params: ParamsFor<typeof Method.PRESENT_PING>,
): Record<string, unknown> {
  const canvas = (globalThis as Record<string, unknown>).canvas as CanvasLike | undefined;
  if (!canvas || typeof canvas.ping !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "canvas.ping is not available (no active canvas)",
    );
  }
  canvas.ping({ x: params.x, y: params.y });
  return { pinged: { x: params.x, y: params.y } };
}

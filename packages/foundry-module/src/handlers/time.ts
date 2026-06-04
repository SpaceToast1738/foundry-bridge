import { BridgeError, ErrorCode, Method, type ParamsFor } from "@foundry-bridge/shared";

function requireTime(): NonNullable<typeof game.time> {
  const time = game.time;
  if (!time || typeof time.advance !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      "game.time is not available in this Foundry client",
    );
  }
  return time;
}

export async function handleTimeAdvance(
  params: ParamsFor<typeof Method.TIME_ADVANCE>,
): Promise<{ worldTime: number; advancedBy: number }> {
  const time = requireTime();
  await time.advance(params.seconds);
  return { worldTime: time.worldTime, advancedBy: params.seconds };
}

export async function handleTimeSet(
  params: ParamsFor<typeof Method.TIME_SET>,
): Promise<{ worldTime: number; advancedBy: number }> {
  const time = requireTime();
  const delta = params.worldTime - time.worldTime;
  if (delta !== 0) {
    await time.advance(delta);
  }
  return { worldTime: time.worldTime, advancedBy: delta };
}

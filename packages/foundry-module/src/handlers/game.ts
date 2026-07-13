import { Method, type ParamsFor } from "@foundry-bridge/shared";

/** Pause or unpause the game. With no `paused` argument, toggles the current
 * state. Foundry's `game.togglePause(state)` broadcasts to all connected
 * clients and flips the on-screen pause banner. */
export function handleGamePause(
  params: ParamsFor<typeof Method.GAME_PAUSE>,
): Record<string, unknown> {
  game.togglePause(params?.paused);
  return { paused: game.paused ?? false };
}

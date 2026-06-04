import { BridgeError, ErrorCode } from "./errors.js";

/**
 * Race a promise against a timeout so a wedged operation reports an actionable
 * error instead of hanging. Used module-side to bound headless Foundry calls
 * (canvas/dialog/socket ops can stall) below the relay's 30s ceiling, turning
 * an opaque TIMEOUT into a "do X" message.
 *
 * The underlying promise is left to settle on its own (it can't be cancelled) —
 * we just stop waiting on it.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BridgeError(ErrorCode.TIMEOUT, message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Standard bounds (ms) for headless Foundry ops, all under the relay's 30s. */
export const Timeout = {
  /** Scene placeable writes (walls/tokens/lights/notes) — canvas-bound. */
  PLACEABLE: 20_000,
  /** Scene / combat activation — canvas render. */
  ACTIVATE: 15_000,
  /** Journal popout / share to players. */
  PRESENT: 10_000,
  /** Posting a roll to chat. */
  CHAT: 10_000,
  /** Playlist / sound start-stop. */
  AUDIO: 8_000,
  /** Stored macro execution (user code may loop) — kept under the relay ceiling. */
  MACRO: 25_000,
} as const;

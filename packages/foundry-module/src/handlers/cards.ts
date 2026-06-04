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

interface CardLike {
  id?: string;
  name?: string;
}

interface CardsDoc {
  id?: string;
  name?: string;
  cards?: { contents?: unknown[]; size?: number };
  deal?(to: CardsDoc[], number?: number, options?: Record<string, unknown>): Promise<unknown>;
  draw?(from: CardsDoc, number?: number, options?: Record<string, unknown>): Promise<unknown>;
  shuffle?(options?: Record<string, unknown>): Promise<unknown>;
  pass?(to: CardsDoc, ids: string[], options?: Record<string, unknown>): Promise<unknown>;
  reset?(options?: Record<string, unknown>): Promise<unknown>;
}

// Keep the headless client quiet — these stacks otherwise post a chat card.
const QUIET = { chatNotification: false } as const;

function resolveStack(ref: DocRef): CardsDoc {
  const cards = getCollection("cards");
  const raw = cards && findInCollection(cards, ref);
  if (!raw) {
    throw new BridgeError(
      ErrorCode.NOT_FOUND,
      `Card stack not found by ref ${JSON.stringify(ref)}`,
    );
  }
  return raw as CardsDoc;
}

function requireMethod<K extends keyof CardsDoc>(stack: CardsDoc, method: K): NonNullable<CardsDoc[K]> {
  const fn = stack[method];
  if (typeof fn !== "function") {
    throw new BridgeError(
      ErrorCode.UNAVAILABLE,
      `Card stack '${stack.name ?? stack.id}' does not support ${String(method)}()`,
    );
  }
  return fn as NonNullable<CardsDoc[K]>;
}

function cardCount(stack: CardsDoc): number {
  const c = stack.cards;
  if (!c) return 0;
  if (typeof c.size === "number") return c.size;
  return c.contents?.length ?? 0;
}

function cardNames(result: unknown): string[] {
  if (!Array.isArray(result)) return [];
  return result.map((c) => (c as CardLike)?.name ?? "").filter(Boolean);
}

export async function handleCardsDeal(
  params: ParamsFor<typeof Method.CARDS_DEAL>,
): Promise<Record<string, unknown>> {
  const deck = resolveStack(params.deck);
  const deal = requireMethod(deck, "deal");
  const hands = params.to.map((ref) => resolveStack(ref));
  const number = params.number ?? 1;
  await deal.call(deck, hands, number, QUIET);
  return {
    deck: deck.id,
    dealtPerHand: number,
    hands: hands.map((h) => ({ _id: h.id, name: h.name, cards: cardCount(h) })),
  };
}

export async function handleCardsDraw(
  params: ParamsFor<typeof Method.CARDS_DRAW>,
): Promise<Record<string, unknown>> {
  const to = resolveStack(params.to);
  const from = resolveStack(params.from);
  const draw = requireMethod(to, "draw");
  const number = params.number ?? 1;
  const drawn = await draw.call(to, from, number, QUIET);
  return {
    to: to.id,
    from: from.id,
    drawn: cardNames(drawn),
    handSize: cardCount(to),
  };
}

export async function handleCardsShuffle(
  params: ParamsFor<typeof Method.CARDS_SHUFFLE>,
): Promise<Record<string, unknown>> {
  const deck = resolveStack(params.deck);
  const shuffle = requireMethod(deck, "shuffle");
  await shuffle.call(deck, QUIET);
  return { deck: deck.id, shuffled: true, cards: cardCount(deck) };
}

export async function handleCardsPass(
  params: ParamsFor<typeof Method.CARDS_PASS>,
): Promise<Record<string, unknown>> {
  const from = resolveStack(params.from);
  const to = resolveStack(params.to);
  const pass = requireMethod(from, "pass");
  const passed = await pass.call(from, to, params.cards, QUIET);
  return {
    from: from.id,
    to: to.id,
    passed: cardNames(passed),
    toSize: cardCount(to),
  };
}

export async function handleCardsReset(
  params: ParamsFor<typeof Method.CARDS_RESET>,
): Promise<Record<string, unknown>> {
  const deck = resolveStack(params.deck);
  const reset = requireMethod(deck, "reset");
  await reset.call(deck, QUIET);
  return { deck: deck.id, reset: true, cards: cardCount(deck) };
}

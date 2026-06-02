import {
  BridgeError,
  ErrorCode,
  decodeRequest,
  encode,
  type Response,
} from "@foundry-bridge/shared";
import type { PermissionState } from "./permissions.js";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "close" | "error" | "message",
    handler: (event: { data?: unknown }) => void,
  ): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type Dispatcher = (
  method: string,
  params: unknown,
  state: PermissionState,
) => Promise<unknown>;

export interface BridgeOptions {
  url: string;
  dispatch: Dispatcher;
  getState: () => PermissionState;
  factory?: WebSocketFactory;
  logger?: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  /** Override exponential backoff schedule. Defaults to 1000 * 2^retryCount, capped at 30000ms. */
  backoff?: (retryCount: number) => number;
  scheduler?: (fn: () => void, ms: number) => { cancel: () => void };
}

const defaultFactory: WebSocketFactory = (url) =>
  // Browser-only at runtime. Tests inject a fake factory.
  new WebSocket(url) as unknown as WebSocketLike;

const defaultBackoff = (retryCount: number) =>
  Math.min(30_000, 1_000 * 2 ** retryCount);

const defaultScheduler = (fn: () => void, ms: number) => {
  const handle = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(handle) };
};

const noopLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class Bridge {
  private ws: WebSocketLike | null = null;
  private retryCount = 0;
  private closed = false;
  private pendingReconnect: { cancel: () => void } | null = null;

  private readonly url: string;
  private readonly dispatch: Dispatcher;
  private readonly getState: () => PermissionState;
  private readonly factory: WebSocketFactory;
  private readonly logger: NonNullable<BridgeOptions["logger"]>;
  private readonly backoff: (retryCount: number) => number;
  private readonly scheduler: NonNullable<BridgeOptions["scheduler"]>;

  constructor(opts: BridgeOptions) {
    this.url = opts.url;
    this.dispatch = opts.dispatch;
    this.getState = opts.getState;
    this.factory = opts.factory ?? defaultFactory;
    this.logger = opts.logger ?? noopLogger;
    this.backoff = opts.backoff ?? defaultBackoff;
    this.scheduler = opts.scheduler ?? defaultScheduler;
  }

  connect(): void {
    if (this.closed) return;
    if (this.pendingReconnect) {
      this.pendingReconnect.cancel();
      this.pendingReconnect = null;
    }
    let ws: WebSocketLike;
    try {
      ws = this.factory(this.url);
    } catch (err) {
      this.logger.error(
        `[foundry-bridge] connect failed: ${(err as Error).message}`,
      );
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.retryCount = 0;
      this.logger.log(`[foundry-bridge] connected to ${this.url}`);
    });
    ws.addEventListener("message", (ev) => {
      void this.handleMessage(typeof ev.data === "string" ? ev.data : String(ev.data ?? ""));
    });
    ws.addEventListener("close", () => {
      this.logger.warn(`[foundry-bridge] socket closed`);
      this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      this.logger.warn(`[foundry-bridge] socket error`);
    });
  }

  close(): void {
    this.closed = true;
    this.pendingReconnect?.cancel();
    this.pendingReconnect = null;
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.backoff(this.retryCount);
    this.retryCount += 1;
    this.logger.log(`[foundry-bridge] reconnecting in ${delay}ms`);
    this.pendingReconnect = this.scheduler(() => {
      this.pendingReconnect = null;
      this.connect();
    }, delay);
  }

  private async handleMessage(raw: string): Promise<void> {
    let req;
    try {
      req = decodeRequest(raw);
    } catch (err) {
      this.logger.error(
        `[foundry-bridge] malformed request: ${(err as Error).message}`,
      );
      return;
    }

    let response: Response;
    try {
      const result = await this.dispatch(req.method, req.params, this.getState());
      response = { id: req.id, ok: true, result };
    } catch (err) {
      const payload =
        err instanceof BridgeError
          ? err.toPayload()
          : { code: ErrorCode.INTERNAL, message: (err as Error)?.message ?? String(err) };
      response = { id: req.id, ok: false, error: payload };
    }
    this.ws?.send(encode(response));
  }
}

import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import {
  BridgeError,
  ErrorCode,
  decodeResponse,
  encode,
  type Method,
  type Request,
} from "@foundry-bridge/shared";

export interface RelayOptions {
  port: number;
  host?: string;
  requestTimeoutMs?: number;
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;

const noopLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: BridgeError) => void;
  timer: NodeJS.Timeout;
}

export class Relay {
  private server: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private actualPort: number | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly host: string;
  private readonly port: number;
  private readonly requestTimeoutMs: number;
  private readonly logger: NonNullable<RelayOptions["logger"]>;

  constructor(opts: RelayOptions) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = opts.logger ?? noopLogger;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ host: this.host, port: this.port });
      this.server = server;
      const onError = (err: Error) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const addr = server.address();
        this.actualPort =
          typeof addr === "object" && addr ? addr.port : this.port;
        this.logger.log(
          `[relay] listening on ws://${this.host}:${this.actualPort}`,
        );
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.on("connection", (ws) => this.acceptConnection(ws));
    });
  }

  stop(): Promise<void> {
    this.rejectAllPending(
      new BridgeError(ErrorCode.UNAVAILABLE, "Relay stopping"),
    );
    if (this.socket) {
      try {
        this.socket.terminate();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === this.socket.OPEN;
  }

  getPort(): number {
    if (this.actualPort === null) {
      throw new Error("Relay not started");
    }
    return this.actualPort;
  }

  call(
    method: Method,
    params: unknown,
    opts: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.readyState !== socket.OPEN) {
        reject(
          new BridgeError(ErrorCode.UNAVAILABLE, "No module connected"),
        );
        return;
      }
      const id = randomUUID();
      const timeoutMs = opts.timeoutMs ?? this.requestTimeoutMs;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BridgeError(
            ErrorCode.TIMEOUT,
            `Method '${method}' timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const req: Request = { id, method, params };
      try {
        socket.send(encode(req));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new BridgeError(
            ErrorCode.INTERNAL,
            `Failed to send request: ${(err as Error).message}`,
          ),
        );
      }
    });
  }

  private acceptConnection(ws: WebSocket): void {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.logger.warn(`[relay] replacing existing module connection`);
      try {
        this.socket.terminate();
      } catch {
        /* ignore */
      }
      this.rejectAllPending(
        new BridgeError(ErrorCode.UNAVAILABLE, "Module reconnected"),
      );
    }
    this.socket = ws;
    this.logger.log(`[relay] module connected`);
    ws.on("message", (raw: RawData) => this.handleMessage(raw.toString()));
    ws.on("close", () => {
      this.logger.warn(`[relay] module disconnected`);
      if (this.socket === ws) {
        this.socket = null;
        this.rejectAllPending(
          new BridgeError(ErrorCode.UNAVAILABLE, "Module disconnected"),
        );
      }
    });
    ws.on("error", (err) => {
      this.logger.error(`[relay] socket error: ${err.message}`);
    });
  }

  private handleMessage(raw: string): void {
    let res;
    try {
      res = decodeResponse(raw);
    } catch (err) {
      this.logger.error(
        `[relay] malformed response: ${(err as Error).message}`,
      );
      return;
    }
    const pending = this.pending.get(res.id);
    if (!pending) {
      this.logger.warn(`[relay] response for unknown id ${res.id}`);
      return;
    }
    this.pending.delete(res.id);
    clearTimeout(pending.timer);
    if (res.ok) {
      pending.resolve(res.result);
    } else {
      pending.reject(new BridgeError(res.error.code, res.error.message));
    }
  }

  private rejectAllPending(err: BridgeError): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
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
  /** Directory for the durable JSONL audit log; undefined disables it. */
  auditDir?: string;
  /** ws ping cadence to detect a half-open module socket (default 30s). */
  pingIntervalMs?: number;
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PING_INTERVAL_MS = 30_000;

const noopLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Cheap, non-sensitive digest of a call's params for the audit log. */
interface CallDigest {
  args?: string;
  docIds?: string[];
}

function auditDigest(params: unknown): CallDigest {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  const docIds: string[] = [];
  const pushId = (v: unknown) => {
    if (typeof v === "string") docIds.push(v);
  };
  pushId(p._id);
  pushId(p.id);
  if (Array.isArray(p.ids)) p.ids.forEach(pushId);
  for (const k of ["ref", "entity", "actor", "combat", "scene", "playlist"]) {
    const r = p[k];
    if (r && typeof r === "object") {
      pushId((r as Record<string, unknown>)._id);
      pushId((r as Record<string, unknown>).id);
    }
  }
  let args: string | undefined;
  try {
    args = JSON.stringify(p);
    if (args.length > 300) args = `${args.slice(0, 300)}…`;
  } catch {
    /* non-serialisable — skip */
  }
  return { args, docIds: docIds.length ? docIds : undefined };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: BridgeError) => void;
  timer: NodeJS.Timeout;
  method: Method;
  startedAt: number;
  digest: CallDigest;
}

export interface RelayStats {
  connectedSince: number | null;
  totalCalls: number;
  errorCount: number;
  lastError: { code: string; message: string; method?: string; ts: number } | null;
}

export interface ActivityEntry {
  method: string;
  ok: boolean;
  ms: number;
  ts: number;
}

const MAX_ACTIVITY = 50;

export class Relay {
  private server: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private actualPort: number | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly host: string;
  private readonly port: number;
  private readonly requestTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly logger: NonNullable<RelayOptions["logger"]>;
  // Observability (A2/A3): cheap in-memory counters + a recent-activity ring.
  private connectedSince: number | null = null;
  private totalCalls = 0;
  private errorCount = 0;
  private lastError: RelayStats["lastError"] = null;
  private readonly activity: ActivityEntry[] = [];
  // Durable audit trail (S5). Best-effort; disabled if the dir isn't writable.
  private auditDir: string | undefined;

  constructor(opts: RelayOptions) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.logger = opts.logger ?? noopLogger;
    if (opts.auditDir) {
      try {
        fs.mkdirSync(opts.auditDir, { recursive: true });
        this.auditDir = opts.auditDir;
      } catch (err) {
        this.logger.warn(
          `[relay] audit log disabled — cannot create ${opts.auditDir}: ${(err as Error).message}`,
        );
      }
    }
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

  getStats(): RelayStats {
    return {
      connectedSince: this.connectedSince,
      totalCalls: this.totalCalls,
      errorCount: this.errorCount,
      lastError: this.lastError,
    };
  }

  /** Most-recent-first list of the last MAX_ACTIVITY calls served. */
  getRecentActivity(): ActivityEntry[] {
    return [...this.activity].reverse();
  }

  private recordSettle(
    method: Method,
    startedAt: number,
    ok: boolean,
    error?: { code: string; message: string },
    digest?: CallDigest,
  ): void {
    const ts = Date.now();
    const ms = ts - startedAt;
    this.activity.push({ method, ok, ms, ts });
    if (this.activity.length > MAX_ACTIVITY) this.activity.shift();
    if (!ok) {
      this.errorCount += 1;
      if (error) this.lastError = { ...error, method, ts };
    }
    this.writeAudit({
      ts,
      method,
      ok,
      ms,
      ...(error ? { err: error.code } : {}),
      ...(digest?.docIds ? { docIds: digest.docIds } : {}),
      ...(digest?.args ? { args: digest.args } : {}),
    });
  }

  /** Append one JSONL line to the day's audit file. Never throws. */
  private writeAudit(entry: Record<string, unknown>): void {
    if (!this.auditDir) return;
    try {
      const day = new Date(entry.ts as number).toISOString().slice(0, 10);
      fs.appendFileSync(
        path.join(this.auditDir, `${day}.jsonl`),
        `${JSON.stringify(entry)}\n`,
      );
    } catch {
      // Best-effort — a failed audit write must never break a tool call.
    }
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
      const startedAt = Date.now();
      const digest = auditDigest(params);
      this.totalCalls += 1;
      const timeoutMs = opts.timeoutMs ?? this.requestTimeoutMs;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const message = `Method '${method}' timed out after ${timeoutMs}ms`;
        this.recordSettle(method, startedAt, false, { code: ErrorCode.TIMEOUT, message }, digest);
        reject(new BridgeError(ErrorCode.TIMEOUT, message));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method, startedAt, digest });
      const req: Request = { id, method, params };
      try {
        socket.send(encode(req));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        const message = `Failed to send request: ${(err as Error).message}`;
        this.recordSettle(method, startedAt, false, { code: ErrorCode.INTERNAL, message }, digest);
        reject(new BridgeError(ErrorCode.INTERNAL, message));
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
    this.connectedSince = Date.now();
    this.logger.log(`[relay] module connected`);

    // Keepalive: a half-open socket (renderer hang, TCP blackhole) still reads
    // as OPEN, so calls would sit the full requestTimeoutMs before failing.
    // Ping periodically; if the previous ping went unanswered, the socket is
    // dead — terminate it so calls fail fast and reconnect kicks in.
    let awaitingPong = false;
    ws.on("pong", () => {
      awaitingPong = false;
    });
    const pingTimer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      if (awaitingPong) {
        this.logger.warn(
          `[relay] module socket unresponsive (missed pong) — terminating`,
        );
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        return;
      }
      awaitingPong = true;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }, this.pingIntervalMs);
    pingTimer.unref?.();

    ws.on("message", (raw: RawData) => this.handleMessage(raw.toString()));
    ws.on("close", () => {
      clearInterval(pingTimer);
      this.logger.warn(`[relay] module disconnected`);
      if (this.socket === ws) {
        this.socket = null;
        this.connectedSince = null;
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
      this.recordSettle(pending.method, pending.startedAt, true, undefined, pending.digest);
      pending.resolve(res.result);
    } else {
      this.recordSettle(
        pending.method,
        pending.startedAt,
        false,
        { code: res.error.code, message: res.error.message },
        pending.digest,
      );
      pending.reject(new BridgeError(res.error.code, res.error.message));
    }
  }

  private rejectAllPending(err: BridgeError): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.recordSettle(
        pending.method,
        pending.startedAt,
        false,
        { code: err.code, message: err.message },
        pending.digest,
      );
      pending.reject(err);
    }
    this.pending.clear();
  }
}

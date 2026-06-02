import { ErrorCode, encode, decodeResponse } from "@foundry-bridge/shared";
import { Bridge, type WebSocketLike } from "../src/bridge";
import type { PermissionState } from "../src/permissions";

type Listener = (event: { data?: unknown }) => void;

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  url: string;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Listener[]> = {
    open: [],
    close: [],
    error: [],
    message: [],
  };

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: "open" | "close" | "error" | "message", handler: Listener): void {
    this.listeners[type].push(handler);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.fire("close", {});
  }

  fire(type: string, event: { data?: unknown }): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

function gmState(): PermissionState {
  return {
    isGM: true,
    writeEnabled: true,
    destructiveEnabled: true,
    maxDeletePerCall: 5,
  };
}

interface Scheduled {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

function makeScheduler() {
  const scheduled: Scheduled[] = [];
  const scheduler = (fn: () => void, ms: number) => {
    const entry: Scheduled = { fn, ms, cancelled: false };
    scheduled.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  };
  return { scheduler, scheduled };
}

describe("Bridge", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  it("answers a request via the dispatch function", async () => {
    const bridge = new Bridge({
      url: "ws://test",
      dispatch: async (method, params) => ({ echoed: { method, params } }),
      getState: gmState,
      factory: (url) => new FakeWebSocket(url),
    });
    bridge.connect();
    const ws = FakeWebSocket.instances[0];
    ws.fire("open", {});
    ws.fire("message", { data: encode({ id: "r1", method: "ping", params: {} }) });

    await new Promise((r) => setImmediate(r));

    expect(ws.sent).toHaveLength(1);
    const res = decodeResponse(ws.sent[0]);
    expect(res.id).toBe("r1");
    if (res.ok) expect(res.result).toMatchObject({ echoed: { method: "ping" } });
  });

  it("returns an error response when dispatch throws", async () => {
    const bridge = new Bridge({
      url: "ws://test",
      dispatch: async () => {
        const e = new Error("nope");
        (e as Error & { code?: string }).code = ErrorCode.FORBIDDEN;
        throw Object.assign(new Error("nope"), { code: ErrorCode.FORBIDDEN });
      },
      getState: gmState,
      factory: (url) => new FakeWebSocket(url),
    });
    bridge.connect();
    const ws = FakeWebSocket.instances[0];
    ws.fire("open", {});
    ws.fire("message", { data: encode({ id: "r2", method: "ping", params: {} }) });

    await new Promise((r) => setImmediate(r));

    const res = decodeResponse(ws.sent[0]);
    expect(res.id).toBe("r2");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ErrorCode.INTERNAL);
  });

  it("ignores malformed requests without sending a response", async () => {
    const bridge = new Bridge({
      url: "ws://test",
      dispatch: async () => ({}),
      getState: gmState,
      factory: (url) => new FakeWebSocket(url),
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    });
    bridge.connect();
    const ws = FakeWebSocket.instances[0];
    ws.fire("open", {});
    ws.fire("message", { data: "not-json" });

    await new Promise((r) => setImmediate(r));

    expect(ws.sent).toEqual([]);
  });

  it("schedules reconnect with exponential backoff", () => {
    const { scheduler, scheduled } = makeScheduler();
    const bridge = new Bridge({
      url: "ws://test",
      dispatch: async () => ({}),
      getState: gmState,
      factory: (url) => new FakeWebSocket(url),
      scheduler,
    });

    bridge.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.fire("close", {});
    expect(scheduled[0].ms).toBe(1_000);

    scheduled[0].fn();
    const ws2 = FakeWebSocket.instances[1];
    ws2.fire("close", {});
    expect(scheduled[1].ms).toBe(2_000);

    scheduled[1].fn();
    FakeWebSocket.instances[2].fire("close", {});
    expect(scheduled[2].ms).toBe(4_000);
  });

  it("resets backoff counter on successful open", () => {
    const { scheduler, scheduled } = makeScheduler();
    const bridge = new Bridge({
      url: "ws://test",
      dispatch: async () => ({}),
      getState: gmState,
      factory: (url) => new FakeWebSocket(url),
      scheduler,
    });

    bridge.connect();
    FakeWebSocket.instances[0].fire("close", {});
    scheduled[0].fn();
    FakeWebSocket.instances[1].fire("close", {});
    expect(scheduled[1].ms).toBe(2_000);

    scheduled[1].fn();
    FakeWebSocket.instances[2].fire("open", {});
    FakeWebSocket.instances[2].fire("close", {});

    expect(scheduled[2].ms).toBe(1_000);
  });

  it("stops reconnecting once close() is called", () => {
    const { scheduler, scheduled } = makeScheduler();
    const bridge = new Bridge({
      url: "ws://test",
      dispatch: async () => ({}),
      getState: gmState,
      factory: (url) => new FakeWebSocket(url),
      scheduler,
    });

    bridge.connect();
    bridge.close();
    FakeWebSocket.instances[0].fire("close", {});
    expect(scheduled.some((s) => !s.cancelled)).toBe(false);
  });
});

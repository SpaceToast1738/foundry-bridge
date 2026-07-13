import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import WebSocket from "ws";
import { ErrorCode, Method, decodeRequest } from "@foundry-bridge/shared";
import { Relay } from "../src/relay";

function connectModule(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function expectOneRequest(ws: WebSocket): Promise<{ id: string; method: string; params: unknown }> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => {
      try {
        resolve(decodeRequest(raw.toString()));
      } catch (err) {
        reject(err);
      }
    });
  });
}

describe("Relay", () => {
  let relay: Relay;

  afterEach(async () => {
    if (relay) {
      await relay.stop().catch(() => undefined);
    }
  });

  it("rejects call() with UNAVAILABLE when no module is connected", async () => {
    relay = new Relay({ port: 0 });
    await relay.start();
    await expect(relay.call(Method.PING, {})).rejects.toMatchObject({
      code: ErrorCode.UNAVAILABLE,
    });
  });

  it("routes a request to the module and resolves with the result", async () => {
    relay = new Relay({ port: 0 });
    await relay.start();
    const module = await connectModule(relay.getPort());

    module.on("message", (raw) => {
      const req = decodeRequest(raw.toString());
      module.send(
        JSON.stringify({ id: req.id, ok: true, result: { echoed: req.method } }),
      );
    });

    const result = await relay.call(Method.PING, {});
    expect(result).toEqual({ echoed: Method.PING });
    module.close();
  });

  it("appends a JSONL audit line per settled call, with doc ids", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-audit-"));
    relay = new Relay({ port: 0, auditDir: dir });
    await relay.start();
    const module = await connectModule(relay.getPort());
    module.on("message", (raw) => {
      const req = decodeRequest(raw.toString());
      module.send(JSON.stringify({ id: req.id, ok: true, result: {} }));
    });

    await relay.call(Method.DOCUMENTS_GET, {
      collection: "actors",
      ref: { _id: "abc123" },
    });

    const day = new Date().toISOString().slice(0, 10);
    const lines = fs
      .readFileSync(path.join(dir, `${day}.jsonl`), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const entry = lines.find((l) => l.method === Method.DOCUMENTS_GET);
    expect(entry).toMatchObject({ method: Method.DOCUMENTS_GET, ok: true });
    expect(entry.docIds).toContain("abc123");
    expect(typeof entry.ms).toBe("number");
    module.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("propagates an error response as a BridgeError", async () => {
    relay = new Relay({ port: 0 });
    await relay.start();
    const module = await connectModule(relay.getPort());

    module.on("message", (raw) => {
      const req = decodeRequest(raw.toString());
      module.send(
        JSON.stringify({
          id: req.id,
          ok: false,
          error: { code: ErrorCode.FORBIDDEN, message: "no" },
        }),
      );
    });

    await expect(relay.call(Method.DOCUMENTS_DELETE, { type: "Actor", ids: ["a"] })).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    module.close();
  });

  it("rejects pending calls with UNAVAILABLE when the module disconnects", async () => {
    relay = new Relay({ port: 0 });
    await relay.start();
    const module = await connectModule(relay.getPort());

    const reqPromise = expectOneRequest(module);
    const call = relay.call(Method.PING, {});
    await reqPromise;

    module.close();

    await expect(call).rejects.toMatchObject({ code: ErrorCode.UNAVAILABLE });
  });

  it("times out a call that the module never answers", async () => {
    relay = new Relay({ port: 0, requestTimeoutMs: 50 });
    await relay.start();
    const module = await connectModule(relay.getPort());

    // Module reads but never replies.
    const reqPromise = expectOneRequest(module);
    const call = relay.call(Method.PING, {});
    await reqPromise;

    await expect(call).rejects.toMatchObject({ code: ErrorCode.TIMEOUT });
    module.close();
  });

  it("respects per-call timeout override", async () => {
    relay = new Relay({ port: 0, requestTimeoutMs: 30_000 });
    await relay.start();
    const module = await connectModule(relay.getPort());

    const reqPromise = expectOneRequest(module);
    const call = relay.call(Method.PING, {}, { timeoutMs: 50 });
    await reqPromise;

    await expect(call).rejects.toMatchObject({ code: ErrorCode.TIMEOUT });
    module.close();
  });

  it("replaces the existing module connection when a new one arrives", async () => {
    relay = new Relay({ port: 0 });
    await relay.start();
    const m1 = await connectModule(relay.getPort());

    // Hold a pending call on m1.
    const reqPromise = expectOneRequest(m1);
    const call = relay.call(Method.PING, {});
    // Attach assertion before the kick to avoid an unhandled-rejection blip.
    const kickAssertion = expect(call).rejects.toMatchObject({
      code: ErrorCode.UNAVAILABLE,
    });
    await reqPromise;

    // Connect a second module — should kick m1 out.
    const m2 = await connectModule(relay.getPort());

    await kickAssertion;

    // The new module can now answer calls.
    m2.on("message", (raw) => {
      const req = decodeRequest(raw.toString());
      m2.send(JSON.stringify({ id: req.id, ok: true, result: "ok" }));
    });
    await expect(relay.call(Method.PING, {})).resolves.toBe("ok");

    m1.close();
    m2.close();
  });

  it("ignores responses for unknown ids", async () => {
    relay = new Relay({ port: 0 });
    await relay.start();
    const module = await connectModule(relay.getPort());

    // Send a stray response with no corresponding pending request.
    module.send(JSON.stringify({ id: "nope", ok: true, result: null }));

    // Wait a beat and verify the relay is still healthy.
    await new Promise((r) => setTimeout(r, 30));
    expect(relay.isConnected()).toBe(true);
    module.close();
  });

  it("tracks stats and recent activity across calls", async () => {
    relay = new Relay({ port: 0 });
    await relay.start();
    const module = await connectModule(relay.getPort());
    module.on("message", (raw) => {
      const req = decodeRequest(raw.toString());
      if (req.method === Method.PING) {
        module.send(JSON.stringify({ id: req.id, ok: true, result: "ok" }));
      } else {
        module.send(
          JSON.stringify({ id: req.id, ok: false, error: { code: ErrorCode.FORBIDDEN, message: "no" } }),
        );
      }
    });
    await new Promise((r) => setTimeout(r, 10));

    await relay.call(Method.PING, {});
    await relay.call(Method.DOCUMENTS_DELETE, { type: "Actor", ids: ["a"] }).catch(() => undefined);

    const stats = relay.getStats();
    expect(stats.totalCalls).toBe(2);
    expect(stats.errorCount).toBe(1);
    expect(stats.lastError).toMatchObject({ code: ErrorCode.FORBIDDEN, method: Method.DOCUMENTS_DELETE });
    expect(typeof stats.connectedSince).toBe("number");

    const activity = relay.getRecentActivity();
    expect(activity).toHaveLength(2);
    // Most-recent-first: the failed delete is first.
    expect(activity[0]).toMatchObject({ method: Method.DOCUMENTS_DELETE, ok: false });
    expect(activity[1]).toMatchObject({ method: Method.PING, ok: true });
    module.close();
  });

  it("isConnected reflects current state", async () => {
    relay = new Relay({ port: 0 });
    await relay.start();
    expect(relay.isConnected()).toBe(false);

    const module = await connectModule(relay.getPort());
    // Wait one tick for accept handler to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(relay.isConnected()).toBe(true);

    module.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(relay.isConnected()).toBe(false);
  });
});

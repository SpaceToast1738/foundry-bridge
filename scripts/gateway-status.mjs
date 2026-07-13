#!/usr/bin/env node
// Probe the gateway's get_status over the loopback MCP endpoint and print the
// parsed status object as JSON. The gateway is unauthenticated on 127.0.0.1
// (Caddy adds auth in front), so no token is needed. Used by redeploy.sh's
// health gate; also handy for manual checks.
//
// Env: FOUNDRY_BRIDGE_GATEWAY_PORT (default 31415).

const PORT = process.env.FOUNDRY_BRIDGE_GATEWAY_PORT ?? "31415";
const BASE = `http://127.0.0.1:${PORT}/mcp`;
const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

/** Extract the JSON-RPC result from a response that may be SSE or plain JSON. */
function parseBody(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  for (const line of trimmed.split("\n")) {
    const m = line.match(/^data:\s*(.*)$/);
    if (m && m[1].trim().startsWith("{")) return JSON.parse(m[1]);
  }
  throw new Error("no JSON payload in response");
}

async function main() {
  const initRes = await fetch(BASE, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "gateway-status", version: "0" },
      },
    }),
  });
  const sid = initRes.headers.get("mcp-session-id");
  if (!sid) throw new Error("no session id from initialize");

  const authed = { ...HEADERS, "mcp-session-id": sid };
  await fetch(BASE, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const res = await fetch(BASE, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "2",
      method: "tools/call",
      params: { name: "get_status", arguments: {} },
    }),
  });
  const rpc = parseBody(await res.text());
  const text = rpc?.result?.content?.[0]?.text;
  // get_status wraps the status object as JSON in a text content block.
  process.stdout.write(text ?? JSON.stringify(rpc));
}

main().catch((err) => {
  console.error(`[gateway-status] ${err.message}`);
  process.exit(1);
});

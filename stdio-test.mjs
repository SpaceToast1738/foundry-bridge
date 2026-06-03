// Spawn the stdio MCP server and exercise it over stdin/stdout (newline-delimited JSON-RPC).
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  FOUNDRY_BRIDGE_STDIO: "1",
  FOUNDRY_BRIDGE_PORT: "31414",
  FOUNDRY_CREDENTIALS: process.cwd() + "/packages/mcp-server/config/foundry_credentials.json",
};
const child = spawn("node", ["packages/mcp-server/build/server.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env,
});

let buf = "";
let done = false;
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id === 1) {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    } else if (m.id === 2) {
      const names = (m.result?.tools ?? []).map((t) => t.name);
      console.log("STDIO tools/list ->", names.length, "tools:", names.join(", "));
      // give the in-browser module a few seconds to reconnect to the fresh relay
      console.log("waiting 6s for module to reconnect, then get_world...");
      setTimeout(() => send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_world", arguments: {} } }), 6000);
    } else if (m.id === 3) {
      done = true;
      const text = m.result?.content?.[0]?.text ?? JSON.stringify(m.result);
      let out = text;
      try { const w = JSON.parse(text); out = "title=" + w.title + " id=" + w.id; } catch { /* raw */ }
      console.log("STDIO get_world ->", String(out).slice(0, 400));
      child.kill();
      process.exit(0);
    }
  }
});

child.on("exit", (code) => { if (!done) { console.error("server exited early, code", code); process.exit(1); } });

setTimeout(() => {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "stdio-test", version: "0" } } });
}, 1500);

setTimeout(() => { if (!done) { console.error("TIMEOUT"); child.kill(); process.exit(1); } }, 30000);

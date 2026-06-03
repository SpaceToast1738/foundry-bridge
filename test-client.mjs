// Minimal MCP client to exercise the local foundry-bridge HTTP endpoint.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL ?? "http://127.0.0.1:31415/mcp");
const transport = new StreamableHTTPClientTransport(url);
const client = new Client({ name: "desktop-test", version: "0" }, { capabilities: {} });

await client.connect(transport);
const tools = await client.listTools();
console.log("TOOLS (" + tools.tools.length + "):", tools.tools.map((t) => t.name).join(", "));

const res = await client.callTool({ name: "get_world", arguments: {} });
const text = res.content?.[0]?.text ?? JSON.stringify(res);
let summary = text;
try {
  const w = JSON.parse(text);
  summary = "title=" + w.title + " | id=" + w.id + " | system=" + w.system + " | core=" + (w.coreVersion ?? w.version);
} catch { /* keep raw */ }
console.log("get_world ->", summary.slice(0, 500));

await client.close();

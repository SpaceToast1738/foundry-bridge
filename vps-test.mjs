// Verify the live VPS bridge end-to-end. Reads the bearer token from the
// Claude Desktop config (never prints it); prints only tool list + get_world.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";

const cfgPath = "C:/Users/jspen/AppData/Roaming/Claude/claude_desktop_config.json";
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const auth = cfg.mcpServers?.["foundry-bridge"]?.env?.AUTH_HEADER;
if (!auth || auth.includes("__PASTE_TOKEN__")) {
  console.error("Token NOT set in config (still placeholder). Run the PowerShell replace first.");
  process.exit(2);
}
console.log("auth header present:", auth.startsWith("Bearer ") && auth.length > 12 ? "yes (Bearer +" + (auth.length - 7) + " chars)" : "MALFORMED");

const url = new URL("https://foundry-mcp.spencer-net.com/mcp");
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { Authorization: auth } },
});
const client = new Client({ name: "vps-test", version: "0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log("TOOLS (" + tools.tools.length + "):", tools.tools.map((t) => t.name).join(", "));
  const res = await client.callTool({ name: "get_world", arguments: {} });
  const text = res.content?.[0]?.text ?? JSON.stringify(res);
  if (res.isError) {
    console.log("get_world ERROR ->", String(text).slice(0, 400));
  } else {
    try {
      const w = JSON.parse(text);
      console.log("get_world OK -> title=" + w.title + " | id=" + w.id);
    } catch {
      console.log("get_world ->", String(text).slice(0, 400));
    }
  }
  await client.close();
} catch (err) {
  console.error("CONNECT/CALL FAILED ->", err?.message ?? String(err));
  process.exit(1);
}

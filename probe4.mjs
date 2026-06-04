import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
const auth = JSON.parse(fs.readFileSync("C:/Users/jspen/AppData/Roaming/Claude/claude_desktop_config.json","utf8")).mcpServers["foundry-bridge"].env.AUTH_HEADER;
const t = new StreamableHTTPClientTransport(new URL("https://foundry-mcp.spencer-net.com/mcp"), { requestInit: { headers: { Authorization: auth } } });
const c = new Client({ name: "probe4", version: "0" }, { capabilities: {} });
await c.connect(t);
const J = (r) => { try { return JSON.parse(r.content?.[0]?.text ?? "null"); } catch { return r.content?.[0]?.text; } };
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: J(r), raw: r.content?.[0]?.text }; };
const sid = "iEf7g2u1bY7adzdZ";
const t0 = Date.now();
const dw = await call("draw_walls", { scene: { _id: sid }, segments: [
  { x1: 200, y1: 200, x2: 800, y2: 200 },
  { x1: 800, y1: 200, x2: 800, y2: 800, door: 1, ds: 0 },
  { x1: 800, y1: 800, x2: 200, y2: 800 },
  { x1: 200, y1: 800, x2: 200, y2: 200 },
]});
console.log(`draw_walls (active "test"): ${dw.isError?"ERR":"ok"} (${Date.now()-t0}ms)`, dw.isError ? (dw.raw||"").replace(/\s+/g," ").slice(0,140) : "created="+dw.data?.created);
if (!dw.isError) {
  const sc = await call("get_scene", { _id: sid, requested_fields: ["walls"] });
  console.log("walls now on scene:", Array.isArray(sc.data?.walls) ? sc.data.walls.length : "(n/a)");
  const ids = (dw.data?.walls||[]).map((w)=>w._id).filter(Boolean);
  if (ids.length) { const d = await call("delete_embedded", { parent_type:"Scene", parent_id:sid, embedded:"Wall", ids }); console.log("cleanup:", d.isError?"ERR "+(d.raw||"").slice(0,60):"deleted "+ids.length); }
}
await c.close();

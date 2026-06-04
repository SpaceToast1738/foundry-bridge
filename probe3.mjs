import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
const auth = JSON.parse(fs.readFileSync("C:/Users/jspen/AppData/Roaming/Claude/claude_desktop_config.json","utf8")).mcpServers["foundry-bridge"].env.AUTH_HEADER;
const t = new StreamableHTTPClientTransport(new URL("https://foundry-mcp.spencer-net.com/mcp"), { requestInit: { headers: { Authorization: auth } } });
const c = new Client({ name: "probe3", version: "0" }, { capabilities: {} });
await c.connect(t);
const J = (r) => { try { return JSON.parse(r.content?.[0]?.text ?? "null"); } catch { return r.content?.[0]?.text; } };
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: J(r), raw: r.content?.[0]?.text }; };

const sc = await call("get_scenes", { requested_fields: ["name","active","width","height"] });
const scene = sc.data?.documents?.[0];
console.log("scene:", JSON.stringify(scene));
const sid = scene?._id;

// Isolate: generic create_embedded Wall (vs draw_walls), explicit scene id.
const t0 = Date.now();
const ce = await call("create_embedded", { parent_type: "Scene", parent_id: sid, embedded: "Wall", data: [{ c: [300,300,700,300] }] });
console.log(`create_embedded Wall: ${ce.isError ? "ERR" : "ok"} (${Date.now()-t0}ms)`, ce.isError ? (ce.raw||"").replace(/\s+/g," ").slice(0,120) : JSON.stringify(ce.data).slice(0,100));

if (!ce.isError) {
  const ids = (ce.data?.documents || ce.data?.created || []).map?.((w)=>w._id).filter(Boolean) || [];
  const sc2 = await call("get_scene", { _id: sid, requested_fields: ["walls"] });
  console.log("walls now:", Array.isArray(sc2.data?.walls) ? sc2.data.walls.length : "(n/a)");
  if (ids.length) { const d = await call("delete_embedded", { parent_type:"Scene", parent_id:sid, embedded:"Wall", ids }); console.log("cleanup:", d.isError?"ERR":"deleted "+ids.length); }
}
await c.close();

# foundry-bridge

Documented-API Foundry VTT ⇄ MCP bridge. Templated on [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp); scoped to folder filing + generic document CRUD.

See [HANDOFF.md on foundry-mcp:fix/audit-and-sdk-1x](https://github.com/SpaceToast1738/foundry-mcp/blob/fix/audit-and-sdk-1x/HANDOFF.md) for background on why we pivoted away from the raw-WebSocket approach.

## Packages

- `packages/shared` — RPC envelope types + Zod schemas shared by the module and the server.
- `packages/foundry-module` — Foundry VTT module. Runs inside Foundry's client; dials out to the MCP server.
- `packages/mcp-server` — Node MCP server (stdio). Hosts a loopback WebSocket relay that the module connects to.

## Architecture

```
external MCP client → Caddy → supergateway (stdio↔HTTP/SSE) → mcp-server
                                                                  ↑ ws://127.0.0.1
                                                            foundry-module
                                                                  ↑ in-process
                                                          Foundry (headless Chromium)
```

## Quickstart

```bash
npm install
npm run build
npm test
npm run lint
```

Credentials live in `packages/mcp-server/config/foundry_credentials.json` (gitignored).

## Desktop (stdio) usage

For a local desktop client (e.g. Claude Desktop) the MCP server can run in **stdio mode**
instead of HTTP — the client spawns it and manages its lifecycle. The loopback relay still
runs, so a connected Foundry client (a GM browser tab, or the headless launcher) feeds it.

Enable with `FOUNDRY_BRIDGE_STDIO=1` (or `--stdio`). Claude Desktop config
(`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "foundry-bridge": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\path\\to\\foundry-bridge\\packages\\mcp-server\\build\\server.js"],
      "env": {
        "FOUNDRY_BRIDGE_STDIO": "1",
        "FOUNDRY_BRIDGE_PORT": "31414",
        "FOUNDRY_CREDENTIALS": "C:\\path\\to\\foundry-bridge\\packages\\mcp-server\\config\\foundry_credentials.json"
      }
    }
  }
}
```

A GM Foundry session (with the `foundry-bridge` module enabled) must be connected to the relay
for tools to return data; otherwise calls return `UNAVAILABLE` ("No module connected").

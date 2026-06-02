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

# HANDOFF — foundry-bridge

> Pick-up notes for continuing on another machine. Updated: 2026-06-03.

## TL;DR
`foundry-bridge` is our **documented-API** Foundry VTT ⇄ MCP bridge, templated on
[adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp) (MIT, verified on Foundry
v14) and scoped to **folder filing + generic document CRUD**. It replaces the earlier raw-WebSocket
attempt (`SpaceToast1738/foundry-mcp`, branch `fix/audit-and-sdk-1x`), which broke on Foundry v14's
read path — see that repo's `HANDOFF.md` for the why.

**Code is healthy; the open edge is the headless-browser integration + a doc/config cleanup.**

## Repo / branch
- Repo: `SpaceToast1738/foundry-bridge`, default branch `main` (origin).
- Verified on this machine: `npm install && npm run build && npm test && npm run lint` →
  **128 tests pass (16 suites)**, lint clean, build clean, 0 vulnerabilities.

## Architecture (current — supergateway was dropped)
```
external MCP client → Caddy (TLS + bearer) → mcp-server (in-code Streamable HTTP)
                                                   ↑ ws://127.0.0.1:31414  (loopback relay)
                                             foundry-module  (runs inside Foundry's client)
                                                   ↑ in-process documented game/Document API
                                             Foundry world  (headless Chromium via Playwright)
```
- `packages/shared` — RPC envelope types + Zod schemas shared by module and server.
- `packages/foundry-module` — the Foundry module: `bridge.ts`, `dispatch.ts`,
  `handlers/{world,documents,folders,ping}.ts`, `permissions.ts`, `collections.ts`, `settings.ts`,
  `module.json`. Dials out to the loopback relay; calls the documented API.
- `packages/mcp-server` — Node MCP server: `server.ts` (stdio + Streamable HTTP), `relay.ts`
  (loopback WS the module connects to), `tools.ts`, `core/{config,credentials}.ts`.
- `scripts/launcher.mjs` — Playwright launcher: starts headless Chromium, logs into Foundry as
  `mcp-bridge`, joins the world, loads the module.

## Tools exposed
Hand-written: `get_world`, `create_document`, `modify_document`, `delete_document`, `create_folder`,
`move_to_folder`, `show_credentials`, `ping` — plus generated per-collection `get_*` read tools
(~20 total). **Permission tiers:** reads always allowed; **write tier on by default**;
**destructive tier (delete) OFF by default** → `delete_document` returns `FORBIDDEN` until enabled in
the module's world settings.

## Environment facts
- Foundry: `foundry.spencer-net.com`, **v14 Build 363**, world **"The Shattered Orrery"**.
- Dedicated user **`mcp-bridge`** (Assistant GM). Get its document `_id` from the GM console (in the
  launched world): `game.users.getName("mcp-bridge").id`.
- Credentials are **gitignored**. Local dev path: `packages/mcp-server/config/foundry_credentials.json`.
  VPS path: `/etc/foundry-bridge/credentials.json` (via `FOUNDRY_CREDENTIALS`). Template:
  `deploy/credentials.example.json`. **Never commit the password.**
- Key env (see `deploy/env.example`): `FOUNDRY_BRIDGE_PORT=31414` (relay), `FOUNDRY_BRIDGE_HOST=127.0.0.1`,
  `FOUNDRY_BRIDGE_CREDENTIAL_ID=shattered-orrery`, `FOUNDRY_BRIDGE_GATEWAY_PORT=31415` (HTTP),
  `PLAYWRIGHT_USER_DATA_DIR`, `FOUNDRY_BRIDGE_HEADLESS=true`.
- **Dooley's bridge stays live**; this one **coexists read-only** until the cutover (DEPLOY.md step 10).

## Open items / next steps
1. **Live blocker — headless launcher integration (unverified end-to-end).** Get `scripts/launcher.mjs`
   to log into live Foundry and the module to connect: browser journal should show
   `[launcher][info] joined world` then `[foundry-bridge] connected to ws://127.0.0.1:31414`. Recent
   commits added diagnostic logging for failing network requests / Chromium loopback + mixed-content
   handling — this is the active debugging front. To reproduce locally you need Playwright's Chromium
   (`npx playwright install chromium`) + the creds file. See the troubleshooting table in `DEPLOY.md`.
2. **Doc/config cleanup — stale `supergateway` references.** The gateway systemd unit now runs
   `packages/mcp-server/build/server.js` directly (Streamable HTTP in-code), but `README.md`,
   `DEPLOY.md`, and `deploy/env.example` still mention **supergateway** in the diagrams/comments/
   smoke-test. Update them to match (mcp-server serves HTTP directly; confirm it binds
   `FOUNDRY_BRIDGE_GATEWAY_PORT`).
3. **VPS deploy** per `DEPLOY.md`: build (`npm run dist`), install the module zip + enable it in the
   world (open its settings once to materialise defaults), provision the `foundry-bridge` system user,
   systemd units, Caddy bearer-token route at `foundry-mcp.spencer-net.com`.
4. **End-to-end verify:** remote `get_world` → `{ title: "The Shattered Orrery" }`; `create_folder`
   (JournalEntry); `move_to_folder`; confirm `delete_document` → `FORBIDDEN` until the destructive tier
   is flipped (only after a clean read/write week).

## Hosting gotchas
- The **headless browser is required** (documented-API path needs a live client).
- The **world must stay launched** — if Foundry drops to the Setup screen, the bridge breaks.
- Keep credentials secret + gitignored; bearer-token the Caddy route.

## Build / verify commands
```bash
npm install
npm run build      # tsc --build across packages
npm test           # jest — 128 tests
npm run lint       # eslint
npm run dist       # build installable module + server.js artifacts
```

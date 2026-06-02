# Deploying foundry-bridge to the VPS

Target shape — everything co-located on the same box as Foundry:

```
external MCP client → Caddy (TLS + bearer) → supergateway → mcp-server
                                                                ↑
                                                         ws://127.0.0.1:31414
                                                                ↑
                                                        headless Chromium
                                                          + foundry-bridge
                                                                ↑
                                                            Foundry world
```

## 0. Prerequisites on the VPS

- Node ≥ 20 (`node --version`)
- Caddy ≥ 2.7
- A dedicated Foundry user `mcp-bridge` with Assistant GM role (created in the GM UI; its document `_id` is what goes in `credentials.json`)
- A subdomain DNS record for `mcp.spencer-net.com` pointing at the VPS
- A long random bearer token: `openssl rand -hex 32`

## 1. Build the artifacts locally

```bash
git clone https://github.com/SpaceToast1738/foundry-bridge.git
cd foundry-bridge
npm install
npm run dist
```

Outputs:

- `packages/mcp-server/build/server.js` — stdio MCP server
- `packages/foundry-module/dist/{main.js,main.js.map,module.json}` — installable Foundry module

Bundle the module dir into a zip for the Foundry install step:

```bash
( cd packages/foundry-module/dist && zip -r ../../../foundry-bridge-0.1.0.zip . )
```

## 2. Install the Foundry module

1. Copy `foundry-bridge-0.1.0.zip` to the VPS.
2. Unzip into Foundry's modules dir (path depends on your install — typical: `/home/foundry/foundryuserdata/Data/modules/foundry-bridge/`).
3. In the world, enable the module under **Game Settings → Manage Modules → Foundry Bridge**.
4. Open **Game Settings → Configure Settings → Module Settings** and verify the defaults: relay URL `ws://127.0.0.1:31414`, write tier on, destructive tier OFF.

## 3. Provision the VPS for the bridge processes

Run on the VPS as root:

```bash
# System user (no login shell)
useradd --system --no-create-home --shell /usr/sbin/nologin foundry-bridge

# Layout
install -d -o foundry-bridge -g foundry-bridge -m 755 /opt/foundry-bridge
install -d -o root -g foundry-bridge -m 750 /etc/foundry-bridge
install -d -o foundry-bridge -g foundry-bridge -m 750 /var/lib/foundry-bridge
install -d -o foundry-bridge -g foundry-bridge -m 750 /var/log/foundry-bridge
```

Sync the built repo into `/opt/foundry-bridge`:

```bash
rsync -aH --delete \
  --exclude node_modules --exclude .git --exclude '*.tsbuildinfo' \
  ./ root@vps:/opt/foundry-bridge/
ssh root@vps "cd /opt/foundry-bridge && npm ci --omit=dev && chown -R foundry-bridge:foundry-bridge ."
```

> The browser launcher needs Playwright **and** its Chromium runtime — install with:
> ```bash
> ssh root@vps "cd /opt/foundry-bridge && npm install --omit=dev playwright && npx playwright install --with-deps chromium"
> ```
> `--with-deps` pulls the apt packages headless Chromium needs (nss, libdrm, …).

## 4. Configuration files

Place the credentials file (mode 600):

```bash
install -o root -g foundry-bridge -m 640 \
  deploy/credentials.example.json /etc/foundry-bridge/credentials.json
# then edit /etc/foundry-bridge/credentials.json — fill in userid + password
chmod 600 /etc/foundry-bridge/credentials.json
```

The `userid` is the Foundry document `_id` of the `mcp-bridge` user. Get it from the GM console:

```js
game.users.getName("mcp-bridge").id
```

Place the env file:

```bash
install -o root -g foundry-bridge -m 640 \
  deploy/env.example /etc/foundry-bridge/env
# edit /etc/foundry-bridge/env to match your install
```

## 5. systemd

```bash
cp deploy/systemd/foundry-bridge-gateway.service /etc/systemd/system/
cp deploy/systemd/foundry-bridge-browser.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now foundry-bridge-gateway foundry-bridge-browser
```

Verify:

```bash
systemctl status foundry-bridge-gateway foundry-bridge-browser
journalctl -u foundry-bridge-gateway -n 50
journalctl -u foundry-bridge-browser -n 50
```

In the browser journal you should see `[launcher][info] joined world` followed by `[launcher][module] [foundry-bridge] connected to ws://127.0.0.1:31414`.

## 6. Caddy

```bash
cp deploy/caddy/mcp.spencer-net.com.Caddyfile \
  /etc/caddy/sites-available/mcp.spencer-net.com.Caddyfile
# Wire MCP_BRIDGE_TOKEN + FOUNDRY_BRIDGE_GATEWAY_PORT into Caddy's environment.
# On Debian/Ubuntu this is /etc/default/caddy:
cat >> /etc/default/caddy <<'EOF'
MCP_BRIDGE_TOKEN=__paste_the_openssl_rand_value__
FOUNDRY_BRIDGE_GATEWAY_PORT=31415
EOF
# Import the new site (if your main Caddyfile uses `import sites-available/*`).
systemctl restart caddy
```

Caddy will fetch a TLS cert via ACME on first request.

## 7. Smoke test from outside the VPS

```bash
TOKEN=__paste_the_token__
# MCP Streamable HTTP — handshake then a single tool call.
curl -s -X POST https://mcp.spencer-net.com/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'
```

You should see the v1 tool list (~20 tools) come back as JSON-RPC. If you get `Unauthorized` the bearer is wrong; if you get `502/503` check Caddy → supergateway → MCP server → relay → browser in order via `journalctl -u`.

For an end-to-end check that matches the headline goal from the handoff, point an MCP client at the URL+token and:

1. `get_world` → returns `{ title: "The Shattered Orrery", ... }`
2. `create_folder({ type: "JournalEntry", name: "MCP-smoke-YYYYMMDD" })`
3. `move_to_folder({ type: "JournalEntry", entity: { name: "..." }, folder: { name: "MCP-smoke-YYYYMMDD" } })`
4. With the destructive tier still off, `delete_document` should return `FORBIDDEN` — flip the world setting only after a week of clean reads/writes.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Tool calls return `UNAVAILABLE` | Browser service crashed, Foundry dropped to /setup, or the relay port doesn't match between the module setting and `FOUNDRY_BRIDGE_PORT`. Check the browser journal. |
| Browser journal: `Foundry /join form did not expose a userid select` | The Foundry version's login DOM changed. Update the selectors in `scripts/launcher.mjs`. |
| Browser journal: `did not observe [foundry-bridge] connected` | Module isn't enabled in the world, or its settings UI hasn't been opened once to materialise the defaults. Visit the world as GM, enable the module, then `systemctl restart foundry-bridge-browser`. |
| Tool calls hang for 30s then `TIMEOUT` | Module side threw asynchronously without sending a response. Check the browser journal for a `[foundry-bridge]` line near the timestamp. |
| Caddy logs `client_authentication failed` | Bearer mismatch or `MCP_BRIDGE_TOKEN` not exported into Caddy's process. |

## What changes from Dooley's bridge

For the cutover (Step 10): switch the MCP client's `mcpServers` config from Dooley's command-spawn entry to this Streamable-HTTP endpoint. Run read-only for a week before flipping the destructive tier in Foundry's module settings.

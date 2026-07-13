# Feature-Gap Review — foundry-bridge

> Produced 2026-07-13 by a 12-agent review: full tool-surface inventory, five gap-finding
> lenses (core Foundry API, Dooley parity, reliability/ops, dnd5e gameplay, MCP client UX),
> every claim adversarially verified against the code before inclusion. 60 verified findings,
> deduplicated to 52. File references were checked at commit `d8bdc1f`.

## Where the bridge stands

**119 client-visible tools / 95 RPC methods, with complete coverage in both directions**
(no orphan methods, no tool without a module handler). Tiers enforced: 21 read, 70 write,
4 destructive methods. Categories covered: document + embedded CRUD, 11 readable collections,
folders, search/references, chat & dice, scenes/canvas placeables, combat, cards, playlists,
compendium (list/search/import/export/create/delete), 13 dnd5e tools, time, settings/modules,
files/backup, observability (`get_status`, `get_recent_activity`), presentation tools.

This is a mature surface. The gaps below are the delta between "mature" and the two things the
user actually does: **campaign authoring** and — increasingly — **running live dnd5e sessions**.

Live-ops note at review time: bridge healthy end-to-end; `destructiveEnabled` is currently **ON**
in the world settings (was designed default-off — deliberate choice, but see S1).

---

## Tier 0 — Security & data-safety (do first)

| # | Gap | Evidence | Fix | Effort |
|---|-----|----------|-----|--------|
| S1 | **`set_setting` privilege escalation**: a write-tier agent can flip `foundry-bridge.destructiveEnabled`, raise `maxDeletePerCall`, or — worst — repoint `foundry-bridge.serverUrl` at a rogue relay | `handlers/config.ts` has no namespace denylist | Deny `namespace === MODULE_ID` in `handleSettingSet` (and arguably `core.permissions`-class keys behind a confirm) | Small |
| S2 | **Stale session → 400 loop** (known incident): unknown `mcp-session-id` gets a fresh *uninitialized* transport → "Server not initialized" 400s until the client is manually restarted | `server.ts:228-245`, no 404 branch | Return **404** for unknown session ids per MCP spec → `mcp-remote` re-initializes transparently. Kills the "restart Claude Desktop after every deploy" ritual | Small |
| S3 | **Session Map leak** (1 GB RSS incident): sessions never expire; every unknown-id request also constructs a throwaway `Server`+transport | `server.ts:203-232` | Idle TTL sweep + cap; don't construct a session for non-initialize requests (S2 covers) | Small–Med |
| S4 | **No scheduled backups**: `backup_world` is manual-only, same-disk, and off by default — this campaign already survived one world-corruption incident | `deploy/` has no `.timer`; `FOUNDRY_BACKUP_SCRIPT` commented out | systemd timer (daily) + enable env by default in DEPLOY.md; document off-site copy (rclone) as optional | Small |
| S5 | **No durable audit log**: only a 50-entry in-memory ring `{method, ok, ms}` — no params, no doc ids, lost on restart, for an agent with write+destructive power | `relay.ts:53,140-153` | Append JSONL (method, params digest, doc ids, ok/err, ts) under `/var/lib/foundry-bridge/audit/` with rotation | Small |
| S6 | **Gateway binds 0.0.0.0 with zero in-process auth** — all auth lives in Caddy. Mitigated on this VPS by ufw, but the code default is unsafe and `env.example` wrongly claims "loopback only"; other containers on the host can hit 31415 unauthenticated | `server.ts:255`; `env.example:23` | Optional gateway-side bearer (`FOUNDRY_BRIDGE_LOCAL_TOKEN`) or document binding to the Docker bridge IP; fix the env.example comment | Small |
| S7 | No rate limiting; 16 MB `express.json` parsed before any session validation | `server.ts:226`; Caddyfile | Caddy `rate_limit` on both routes; move json limit per-route | Small |
| S8 | Static bearer + secret path with no rotation runbook or per-client revocation | Caddyfile:23-29 | At minimum: a documented rotation script; per-client tokens if phone+desktop should be revocable independently | Med |

## Tier 1 — Quick wins (small effort, immediate value)

**Live-session (dnd5e):**
1. **Advantage/disadvantage/bonus/DC on `dnd5e_roll`** — pervasive in 5e; today impossible (`methods.ts:541-545` passes bare `{ability|skill}`).
2. **Group rolls + multi-target damage** — a fireball vs 6 goblins is currently 12 calls; accept `actors[]`/`targets[]` on roll & damage tools.
3. **Party-wide rest / XP / currency** — end-of-session bookkeeping is 3×N calls today; accept `actors[]` (dnd5e Group actor award API exists).
4. **Concentration save on damage** — `dnd5e_concentration` only checks/breaks; no save roll, no DC calc, no "target was concentrating" flag on damage.
5. **`advance_combat` enum bug** — `next_round`/`previous_round` fully implemented module-side but missing from the tool schema (`tools.ts:555`). One-line fix.
6. **Game pause/unpause** — `game.togglePause` unexposed; not even reported in status.
7. **Show table draws in chat** — `handleTableDraw` hardcodes `displayChat: false` (`dice.ts:127`); add a param.
8. **Playlist next/pause/per-sound stop** — only playAll/stopAll/playSound wrapped.

**Compendium (unlocks encounter prep):**
9. **`get_compendium_entry`** — read a full statblock/spell from a pack *without importing* (index-only today; both the core and Dooley lenses flagged this independently). Add a `compact` statblock mode for token efficiency.
10. **Cross-pack search** — `search_compendium` requires one pack per call; "find Fireball" = N sequential calls.

**Authoring:**
11. **`FilePicker.createDirectory`** — uploads into a new folder (NPC art, handouts) currently fail; target dir must pre-exist.
12. **`get_messages` `since`/cursor/author filters** — enables "recap last session" without guessing where it ended.
13. **Scene thumbnails** — API-built scenes show grey cards until manually opened (`Scene.createThumbnail` never called).

**Client UX:**
14. **MCP tool annotations** (`readOnlyHint`/`destructiveHint`) — `METHOD_TIERS` already classifies all 95 methods; mapping tier→annotation in `buildToolDefinitions` is mechanical and lets clients gate confirmations properly.
15. **Default list limits/projection** — bare `get_actors` returns *every field of every doc* (token bomb, esp. phone); add a default `limit` + summary projection, full data on request.
16. **TIMEOUT messages should say "the write may still have completed"** — module-side writes aren't cancelled when the relay gives up.

**Ops hygiene:**
17. **`redeploy.sh` health gate** — restarts blind; add post-restart `/healthz` + `get_status` poll and print the diff of `moduleCodeVersion`.
18. **Relay WS ping/pong** — a half-open Chromium socket currently burns the full 120s per call before failing.
19. **Docs**: DEPLOY.md/env.example still document the removed supergateway hop; "~88 tools" is stale.

## Tier 2 — Medium bets (high value, more work)

| Gap | Why | Notes |
|-----|-----|-------|
| **`spawn_encounter`** — compendium ref(s) → world actors → tokens on scene → combat with initiative, one call | Today ~10 serial calls; the single highest-leverage live-session tool | Composes existing handlers; batch `place_token` falls out of it |
| **Creature index with CR/type/size filters** (Dooley's `list-creatures-by-criteria`) | "Find me a CR 3-5 undead" is the encounter-building primitive; our index has no CR/XP fields | Pairs with an XP-threshold calculator (small) for encounter budgeting |
| **Scene `view` vs `activate`** | Can't prep a non-active scene without yanking players onto it; placeable tools only work reliably on the active scene | Verifier rated it small–medium |
| **Rich `dnd5e_actor_summary`** | Current summary is name/hp/ac/abilities/level/cr; missing skills, saves, passives, spell DC, slots, attacks, features — the mid-session LLM context staple | `get_roll_data` partially covers; design tiered detail levels |
| **Condition durations + auto-expiry** | "Poisoned 3 rounds" requires hand-built ActiveEffects + manual cleanup | Hook `advance_combat` to expire |
| **Spell preparation tool** | Raw `system.preparation.prepared` paths per spell today | Small handler, big ergonomics |
| **Bulk loot grant** | Treasure parcels are long serial chains (`grant_item` is 1×1) | `grant_items` + party currency split |
| **Nested embedded docs via `fromUuid` parent resolution** | Effects on owned items (magic weapon tuning) unreachable — parents resolve only from world collections (`embedded.ts:35-62`) | Also unlocks Region behaviors |
| **Player roll requests** (Dooley parity) | Clickable roll buttons in chat for *players* — bridges the GM-bot gap when real players are at the table | Needs a small chat-card enricher in the module |
| **Scene screenshots as MCP image content** | The headless Chromium already renders the canvas — `page.screenshot()` piped through launcher→status channel would give map previews no other bridge has | Unique differentiator; medium plumbing |
| **MCP prompts** ("prep session", "recap", "run combat") | Recurring workflows currently live in a 28 KB instructions blob | Small server change, big phone-UX win |
| **Alerting** — ntfy/webhook push when module disconnects / world drops to Setup | Every incident so far was discovered by the user mid-task | Launcher + relay already know; just add a notifier |
| **Tool-count management** (119 flat tools) | Phone/web connector degrades with huge tool lists | Options: profile env var (authoring vs live-session set), or MCP toolsets when spec lands |
| **CI blind spots** | No tests for `server.ts` session lifecycle (where both production bugs lived); no dependabot/audit | Add supertest-based session tests |
| **Adventure pack import** | Purchased dnd5e adventures fail the `WRITABLE_DOCUMENT_TYPES` gate | Only matters if adventures get bought |

## Tier 3 — Large bets (defer until pulled by need)

- **Server→client event push** (chat messages, combat turns via Foundry hooks → MCP notifications). The relay is strictly request/response today; this is the "AI co-DM watches the session live" unlock, but it's an architecture change.
- **dnd5e Advancement API level-up** — real level-ups (ASI/feat choices, subclass, spells known) are interactive; semi-manual via generic tools is acceptable for now.
- **Schema-driven NPC stat-block builder** (Dooley's `dnd5e-create-npc`) — high authoring value but large; a SKILL.md recipe over existing generic tools gets 70% of it.
- **Structured output / MCP resources** — spec-nice, not workflow-blocking.
- **Transaction rollback** — `dry_run` + scheduled backups (S4) are the pragmatic substitute.
- **Multi-system adapters, ComfyUI map gen** — explicitly out of scope.

## Deduplicated cross-lens confirmations

Three gaps were independently found by two lenses each (strong signal):
stale-session 400s (ops+ux), `advance_combat` enum (core+ux), compendium full-read (core+Dooley).

## Suggested order of attack

1. **Security batch** (S1, S2, S3, S5 — one PR, all small): namespace guard, 404 sessions, TTL sweep, audit log.
2. **Backup timer** (S4) + redeploy health gate + docs cleanup.
3. **dnd5e quick-win batch** (T1 items 1-8): roll modifiers, group ops, concentration, enum fix, pause.
4. **Compendium batch** (items 9-10 + CR index): unlocks encounter prep.
5. **`spawn_encounter`** on top of the compendium batch.
6. Client-UX batch: annotations, list defaults, prompts.
7. Then reassess — screenshots and event push are the two "wow" candidates.

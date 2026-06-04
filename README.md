# foundry-bridge

Documented-API Foundry VTT ⇄ MCP bridge. Templated on [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp). Lets an MCP client read, search, organise, and edit a Foundry world through Foundry's own client-side document API — paginated/sorted reads and search across collections, generic document CRUD, embedded documents (journal pages, actor items, map walls/lights/notes, timed active effects), folder filing, compendium browse + import, UUID cross-links, chat, scenes & tokens, scene creation + map geometry (walls/doors/lights/notes), dice & roll tables, combat encounters (incl. per-combatant damage/conditions/defeated), asset upload, actor operations (conditions, ownership, HP), audio/playlist building, chat-log reading, document duplication, player presentation (show/pull/ping), scene environment, cards & decks, game-time control, measured templates (AoE), compendium import **and export**, and macro execution, plus an optional D&D-5e adapter (typed damage, rolls, rests, spell slots, currency, XP, hit dice, death saves, concentration, and item use / attack rolls) — all gated by read/write/destructive permission tiers. A `get_status` health probe (running-code version, relay stats, launcher diagnostics) + `get_recent_activity` log, bounded waits on headless-prone calls, and a one-command redeploy keep it diagnosable in production.

See [HANDOFF.md on foundry-mcp:fix/audit-and-sdk-1x](https://github.com/SpaceToast1738/foundry-mcp/blob/fix/audit-and-sdk-1x/HANDOFF.md) for background on why we pivoted away from the raw-WebSocket approach.

## Packages

- `packages/shared` — RPC envelope types + Zod schemas shared by the module and the server.
- `packages/foundry-module` — Foundry VTT module. Runs inside Foundry's client; dials out to the MCP server.
- `packages/mcp-server` — Node MCP server (stdio). Hosts a loopback WebSocket relay that the module connects to.

## Architecture

```
external MCP client → Caddy (TLS + bearer) → mcp-server (Streamable HTTP; or stdio)
                                                   ↑ ws://127.0.0.1  (loopback relay)
                                             foundry-module
                                                   ↑ in-process (documented game API)
                                             Foundry (headless Chromium)
```

The `mcp-server` serves MCP over **Streamable HTTP** (hosted) or **stdio** (desktop — see below); it
hosts a loopback WebSocket relay that the in-Foundry module connects to. Every tool call is executed
by the module inside a live Foundry client via the documented JavaScript API.

## MCP tools

All tools are gated by three permission tiers, each toggled by a world setting in the module:
**read** (always on for the GM), **write** (on by default), **destructive** (off by default — opt in
per world). A call returns `FORBIDDEN` if its tier is off, the bridge user isn't a GM, or a bulk limit
is exceeded; `UNAVAILABLE` if no Foundry client is connected to the relay.

### World & health · `read`
| Tool | Description |
|------|-------------|
| `get_world` | Compact world descriptor: title, system, version, and per-collection counts. |
| `get_status` | Health/diagnostics: relay connectivity, `serverVersion`/`moduleVersion`/**`moduleCodeVersion`** (running bundle vs Foundry's cached manifest), world descriptor, tier states, `relayStats` (connectedSince/totalCalls/errorCount/lastError), **and a `launcher` block** explaining *why* the bridge is down even when the module isn't connected. Returns `{ relayConnected: false, … }` instead of erroring. |
| `get_recent_activity` | The last ~50 bridge calls (`{method, ok, ms, ts}`, most-recent-first). Server-side — answers even when the module is disconnected. |
| `ping` | Health check; returns `{ pong: true, timestamp }`. |

### Reading · `read`
List and single-get tools are generated per collection. Lists accept `where` (exact-match,
AND-combined), `requested_fields` (projection; `_id`/`name`/`uuid` always included), `sort` + `sort_dir`,
`offset`/`limit` (paging), and `max_length` (byte cap). Each list response includes `total`, `count`,
`offset`, `limit`, and **`truncated`** (true if `max_length` dropped documents — page instead of trusting
it). Single-gets take `_id` (preferred) or `name`. Every result carries the document's `uuid`.

| Tool | Description |
|------|-------------|
| `get_actors` / `get_actor` | Actors (PCs, NPCs, monsters). |
| `get_items` / `get_item` | Items (gear, spells, features). |
| `get_journals` / `get_journal` | Journal entries (and their pages). |
| `get_folders` / `get_folder` | Folders. |
| `get_scenes` / `get_scene` | Scenes. |
| `get_users` / `get_user` | Users. |
| `get_tables` / `get_table` | Roll tables. |
| `get_playlists` / `get_playlist` | Playlists. |
| `get_macros` / `get_macro` | Macros. |
| `get_cards` / `get_card` | Card stacks. |
| `get_combats` / `get_combat` | Combat encounters. |

### Search · `read`
| Tool | Description |
|------|-------------|
| `search_documents` | Case-insensitive **substring** search over names (and journal page text) across collections; narrow with `collections`, `type`, and `match_fields` (dotted string fields). Returns lightweight hits (`_id`, `name`, `uuid`, snippet). Use when you don't know the exact name; use `where` for exact-field matches. |

### Documents
| Tool | Tier | Description |
|------|------|-------------|
| `create_document` | write | Create one or more top-level documents of a type (`Actor`, `Item`, `JournalEntry`, `Folder`, `Scene`, `User`, `RollTable`, `Playlist`, `Macro`, `Cards`). |
| `modify_document` | write | Apply one or more deep-merged updates to a document by `_id`. |
| `delete_document` | destructive | Delete documents by `_id`. Permanent; bulk-limited. |
| `duplicate_document` | write | Clone a document (carries embedded items/pages); optional new name/folder. |

### Embedded documents
For documents that live inside a parent — journal **pages** (`JournalEntryPage`), actor **items**/**effects**, scene placeables — edited without rewriting the whole parent.
| Tool | Tier | Description |
|------|------|-------------|
| `create_embedded` | write | Add embedded docs to a parent (e.g. append a journal page, add actor items). |
| `update_embedded` | write | Edit embedded docs in place (each update needs the embedded `_id`). |
| `delete_embedded` | destructive | Delete embedded docs by `_id`. Permanent; bulk-limited. |

The `embedded` name passes straight to Foundry, so any type works — including **map geometry** on a
Scene (`"Wall"`, `"AmbientLight"`, `"Note"`, `"Tile"`, `"Drawing"`) and **timed `ActiveEffect`s** on an
Actor/Item (`duration` in rounds/turns/seconds, `changes:[{key,mode,value}]`). See `INSTRUCTIONS.md`
(*Embedded documents → Map geometry / Active Effects*) for the exact field shapes. Walls also have a
convenience tool, `draw_walls`.

### Actors
Generic actor operations (core APIs / capability-detected — no system schema baked in).
| Tool | Tier | Description |
|------|------|-------------|
| `create_actor` | write | Create an actor (convenience over `create_document`). |
| `grant_item` | write | Add an item to an actor — from a compendium (`pack`+`entry`) or inline `item`. |
| `list_conditions` | read | The world's status conditions (id, name, img). |
| `toggle_condition` | write | Toggle a condition on an actor (e.g. `prone`, `poisoned`). |
| `get_roll_data` | read | An actor's `@`-data, to feed `roll_dice` (`@abilities.dex.mod`). |
| `assign_actor` | write | Set a user's ownership of an actor (give a player their PC). |
| `apply_damage` / `apply_healing` | write | Adjust HP via the system's `applyDamage()`; `UNAVAILABLE` if unsupported (use `modify_document`). |

### Folders · `write`
| Tool | Description |
|------|-------------|
| `create_folder` | Create a folder for a document type; optional `parent` for nesting. |
| `move_to_folder` | File an entity into a folder (by `_id`/`name`), or to the root (`folder: null`). |

### Compendium
| Tool | Tier | Description |
|------|------|-------------|
| `list_compendiums` | read | List available packs (id, label, document type, system); optional type filter. |
| `search_compendium` | read | Search a pack's index by name; returns `_id`, `name`, `type`, `uuid`, `img`. |
| `import_from_compendium` | write | Import pack entries into the world as real documents (optional destination folder; fresh `_id`s). |
| `export_to_compendium` | write | Write world documents back INTO a pack (backups/authoring). Pack must be unlocked and hold that `type`; fresh `_id`s. |

### Chat
| Tool | Tier | Description |
|------|------|-------------|
| `post_chat_message` | write | Post to the chat log. Optional `whisper` (`"gm"` or user refs), `blind`, `speaker_alias`. Public by default — prefer a GM whisper. |
| `get_messages` | read | Read the most recent chat messages (alias, text, whisper, timestamp) for session context. |

### Audio · `write`
| Tool | Description |
|------|-------------|
| `play_playlist` / `stop_playlist` | Start/stop a playlist (music, ambiance), by `_id`/`name`. |
| `play_sound` | Play a single sound within a playlist. |
| `create_playlist` | Create a playlist (mode sequential/shuffle/simultaneous/soundboard), optionally with sounds `{name,path,repeat?,volume?}`. |
| `add_playlist_sounds` | Add sounds to an existing playlist (remove via `delete_embedded` `PlaylistSound`). |

### Scenes & tokens
| Tool | Tier | Description |
|------|------|-------------|
| `get_active_scene` | read | The scene players are viewing (id, name, dimensions, token count). |
| `activate_scene` | write | Make a scene the active/viewed one (by `_id`/`name`). |
| `place_token` | write | Drop a token for an actor at pixel `(x,y)` on a scene (default active), from the actor's prototype token. |
| `update_token` | write | Move/hide/rename a token on a scene by `_id`. (Delete via `delete_embedded`, `embedded:"Token"`.) |
| `update_scene` | write | Update a scene's environment/config (darkness, grid, weather, background); default active. |
| `reset_fog` | write | Clear the fog of war / exploration on a scene. |
| `draw_walls` | write | Add wall segments `{x1,y1,x2,y2, door?, ds?}` to a scene (default active) — blocking + doors. |
| `create_scene` | write | Create a **placeable-ready** scene (sane grid/dimensions) so walls/tokens/lights work immediately; optional `background`/`activate`. Prefer over `create_document` for scenes. |
| `toggle_door` | write | Open/close/lock a door wall (`state` 0/1/2; omit to flip). |
| `place_light` / `place_note` | write | Typed convenience over `create_embedded` `AmbientLight`/`Note`. (Tiles etc. via `create_embedded`.) |
| `place_template` | write | Place a measured template / AoE (`t`: circle/cone/ray/rect) for spell areas. |

### Dice & tables
| Tool | Tier | Description |
|------|------|-------------|
| `roll_dice` | read | Evaluate a dice formula (`"2d6+3"`, `"1d20+@abilities.dex.mod"`); returns total, result, per-die. No chat. |
| `draw_table` | read | Draw from a RollTable (by `_id`/`name`) without posting to chat or marking results drawn. |
| `roll_to_chat` | write | Roll **and** post a dice card (optional `flavor`, `whisper`). |
| `create_table` | write | Create a RollTable, optionally with `formula` + initial `results`. |
| `add_table_results` | write | Add results to a table (strings or `{text, weight}`) and re-normalise. |

### Combat · `write`
| Tool | Description |
|------|-------------|
| `start_combat` | Create + activate a combat encounter on a scene (default active). |
| `add_combatants` | Add combatants from token `_id`s (default active combat). |
| `roll_initiative` | Roll initiative for all (default) or an array of combatant `_id`s. |
| `advance_combat` | `start` / `next` / `previous` / `next_round` / `previous_round` / `end` (end removes the encounter). |
| `set_initiative` | Set a combatant's initiative value. |
| `remove_combatant` | Remove combatants from the encounter by `_id`. |
| `add_combatants` | (now accepts `roll_initiative:true` to roll for the added combatants in one step). |
| `damage_combatant` | Apply damage to a combatant's actor by combatant `_id` (typed on 5e). |
| `update_combatant` | Mark a combatant `defeated`/`hidden` or set `initiative`. |
| `combatant_condition` | Toggle a status condition on a combatant's actor. |

All combat tools return `{ round, turn, combatants:[{ name, initiative, tokenId }] }`.

### Assets & images
| Tool | Tier | Description |
|------|------|-------------|
| `browse_files` | read | List directories/files under a data path (e.g. `worlds/<id>/assets`). |
| `upload_image` | write | Upload a file from base64 into data storage; returns the stored `path` (set it on a doc via `modify_document {img}`). |

### D&D 5e (system adapter)
System-aware tools that only function on a **dnd5e** world (`BAD_REQUEST` otherwise); on 5e, prefer
these over generic `apply_damage` as they respect damage types and traits.
| Tool | Tier | Description |
|------|------|-------------|
| `dnd5e_apply_damage` | write | Typed damage respecting resistances/immunities/vulnerabilities (`type`, `multiplier`). |
| `dnd5e_apply_healing` | write | Heal, or grant temporary HP (`temp:true`). |
| `dnd5e_roll` | write | `save`/`check` (key = ability), `skill` (key = skill code), or `death`; returns the total. |
| `dnd5e_rest` | write | Short or long rest (restores HP/resources). |
| `dnd5e_actor_summary` | read | Compact HP / AC / abilities / level-or-CR sheet readout. |
| `dnd5e_spell_slots` | write | Use/recover/set spell slots by level (1–9 or `pact`); clamped to max. |
| `dnd5e_currency` | write | Add or set coins (pp/gp/ep/sp/cp). |
| `dnd5e_award_xp` | write | Add XP; reports new total, next-level threshold, and `levelUpAvailable` (no auto-level). |
| `dnd5e_hit_dice` | write | Spend/recover pooled hit dice. |
| `dnd5e_death_saves` | write | Set death-save success/failure counters. |
| `dnd5e_concentration` | write | Check or break concentration. |
| `dnd5e_use_item` | write | Use an owned item (weapon/spell/consumable/feature) — full use flow, headless. |
| `dnd5e_item_roll` | write | Roll just an item `attack` or `damage`; returns the total. |

### Present to players · `write`
| Tool | Description |
|------|-------------|
| `show_to_players` | Pop a shared image, or show a journal, to all players. |
| `pull_to_scene` | Pull all players' views to a scene. |
| `ping_location` | Ping a point `(x,y)` on the active scene's canvas. |

### Cards & decks · `write`
| Tool | Description |
|------|-------------|
| `shuffle_cards` | Shuffle a card stack (deck) in place. |
| `deal_cards` | Deal `number` cards from a deck to one or more hands/piles. |
| `draw_cards` | Draw cards into a hand (`to`) from a deck/pile (`from`). |
| `pass_cards` | Pass specific cards (by `_id`) from one stack to another. |
| `reset_cards` | Recall all cards back to the deck (reset the stack). |

### Game time · `write`
| Tool | Description |
|------|-------------|
| `advance_time` | Advance (or rewind, with a negative value) the in-game world clock by `seconds`. |
| `set_world_time` | Set the world clock to an absolute `worldTime` (seconds since the world epoch). |

### Macros · `destructive`
| Tool | Description |
|------|-------------|
| `execute_macro` | Run a stored macro by `_id`/`name` (optional `args`). Runs arbitrary code — destructive-tier gated. |

### Instance · `read`
| Tool | Description |
|------|-------------|
| `show_credentials` | List the configured Foundry credentials (passwords never returned). |

> **Cross-linking:** read/search results include each document's `uuid`. Embed `@UUID[<uuid>]{label}`
> in HTML content to render a clickable Foundry link between documents.

## Quickstart

```bash
npm install
npm run build
npm test
npm run lint
```

Credentials live in `packages/mcp-server/config/foundry_credentials.json` (gitignored).

CI (`.github/workflows/ci.yml`) runs build + test + lint on every push and PR (Node 20).

## Installing the Foundry module

Install/update inside Foundry by manifest URL — **Setup → Add-on Modules → Install Module**, paste:

```
https://github.com/SpaceToast1738/foundry-bridge/releases/latest/download/module.json
```

Tagged releases (push a `v*` tag) are built and published by `.github/workflows/release.yml`, which
attaches the module zip + `module.json` so Foundry can install and auto-update. For a manual build,
`npm run dist` emits the installable module to `packages/foundry-module/dist/`. See `DEPLOY.md` for the
full hosted setup.

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

# foundry-bridge

Documented-API Foundry VTT ⇄ MCP bridge. Templated on [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp). Lets an MCP client read, search, organise, and edit a Foundry world through Foundry's own client-side document API — reading and search across collections, generic document CRUD, embedded documents (journal pages, actor items), folder filing, compendium browse + import, UUID cross-links, chat, scenes & tokens, dice & roll tables, combat encounters, asset upload, actor operations (conditions, ownership, HP), roll tables, audio/playlists, chat-log reading, document duplication, and an optional D&D-5e adapter (typed damage, rolls, rests) — all gated by read/write/destructive permission tiers.

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
| `ping` | Health check; returns `{ pong: true, timestamp }`. |

### Reading · `read`
List and single-get tools are generated per collection. Lists accept `where` (exact-match,
AND-combined), `requested_fields` (projection; `_id`/`name`/`uuid` always included), and `max_length`
(byte cap). Single-gets take `_id` (preferred) or `name`. Every result carries the document's `uuid`.

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
| `search_documents` | Case-insensitive **substring** search over names (and journal page text) across collections. Returns lightweight hits (`_id`, `name`, `uuid`, snippet). Use when you don't know the exact name; use `where` for exact-field matches. |

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

### Scenes & tokens
| Tool | Tier | Description |
|------|------|-------------|
| `get_active_scene` | read | The scene players are viewing (id, name, dimensions, token count). |
| `activate_scene` | write | Make a scene the active/viewed one (by `_id`/`name`). |
| `place_token` | write | Drop a token for an actor at pixel `(x,y)` on a scene (default active), from the actor's prototype token. |
| `update_token` | write | Move/hide/rename a token on a scene by `_id`. (Delete via `delete_embedded`, `embedded:"Token"`.) |

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
| `advance_combat` | `start` / `next` / `previous` / `end` (end removes the encounter). |

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

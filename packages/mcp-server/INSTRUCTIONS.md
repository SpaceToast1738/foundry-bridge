# foundry-bridge — AI Agent Instructions

You are connected to a FoundryVTT game world via the **foundry-bridge** MCP server. Unlike the older `foundry-mcp`, this bridge speaks to a Foundry **module** running inside a live (headless) Foundry client. Every call goes through Foundry's documented JavaScript SDK — `Folder.create`, `Actor.updateDocuments`, etc. — so it is not coupled to undocumented WebSocket internals.

## Permission tiers

The bridge enforces three tiers, each gated by a world setting in the module:

| Tier | Methods | Default |
|------|---------|---------|
| **read** | `get_world`, `get_status`, `get_*`, `search_documents`, `ping` | always on for the GM |
| **write** | `create_*`, `modify_document`, folders, scenes, combat, cards, `advance_time`, `draw_walls`, … | on |
| **destructive** | `delete_document`, `delete_embedded`, `execute_macro` | **off** — opt-in per world |

If a tool returns `FORBIDDEN`, the bridge user is not a GM, the relevant tier is off, or a bulk-limit was exceeded. Do not retry — tell the human.

## First steps

1. Run `get_world` to confirm the bridge is connected and you have the right world.
2. Look for a journal entry named `AGENTS`, `AI Instructions`, or similar. Search with `get_journals` using `where: {"name": "AGENTS"}` or list with `requested_fields: ["name"]` and scan. If a GM left instructions there, follow them.

If a call returns `UNAVAILABLE` or behaves oddly, call **`get_status`** — it reports whether a Foundry
client is connected to the relay (`relayConnected`), the module version, the world (title/system/version
and per-collection counts), and the current **tier states** (`writeEnabled`/`destructiveEnabled`). Unlike
other tools it never errors when nothing is connected — it returns `{ relayConnected: false }`. It also
includes a **`launcher`** block that says *why* the bridge is down even when the module isn't connected:
`launcher.state` is `connected` / `non_gm` (bridge user isn't a GM) / `no_world` (nothing launched) /
`login_failed` (with `launcher.availableUsers` — the users that DO exist) / `error`. Read it before
retrying — it tells you the fix (launch a world, make the bridge user a GM, etc.).

## Reading documents

- List tools per collection: `get_actors`, `get_items`, `get_journals`, `get_folders`, `get_scenes`,
  `get_users`, `get_tables`, `get_playlists`, `get_macros`, `get_cards`, `get_combats`. Use `where` for
  AND-combined **exact-match** filtering and `requested_fields` to project.
- **Paging large collections.** Lists also accept `sort` (field path, e.g. `"name"` or `"system.cr"`),
  `sort_dir` (`"asc"`/`"desc"`), `offset`, and `limit`. Every list response includes `total` (matches
  before paging), `count` (returned), `offset`, `limit`, and **`truncated`**. `max_length` (bytes) trims
  documents from the tail until the JSON fits — if it dropped any, `truncated` is `true`. **When you see
  `truncated: true`, don't trust the list as complete** — narrow with `where`/`requested_fields`, or page
  with `sort` + `offset`/`limit` instead.
- `get_actor` / `get_item` / etc. fetch a single document. Provide `_id` (preferred) or `name`.
- **`search_documents`** does case-insensitive **substring** search over names (and journal page text)
  across collections — use it to find something when you don't know its exact name; use `where` only for
  exact field matches. Returns lightweight hits (`_id`, `name`, `uuid`, snippet).
- **Always inspect a document before modifying it.** System-specific data lives under `system.*` and
  schemas vary by game system.

## Linking documents (`@UUID`)

Every read result includes the document's **`uuid`**. To cross-reference one document from another's
text, embed a Foundry content link: `@UUID[<uuid>]{Optional label}` — e.g.
`@UUID[JournalEntry.abc123]{The Hollow Vale}`. Foundry renders it as a clickable link. Resolve the
target's `uuid` first (via `get_*` or `search_documents`), then write the link into the HTML content.

## Writing documents

- `create_document` takes `type` (Actor / Item / JournalEntry / Folder / Scene / User) and `data: [{...}]`. Provide at minimum a `name`.
- `modify_document` takes `type`, `_id`, and `updates: [{...}]`. Updates are applied in order and deep-merged by Foundry.
- `delete_document` takes `type` and `ids: [...]`. **Permanent.** Subject to the destructive tier and the configured bulk limit.
- `duplicate_document` takes `type`, `ref`, optional `name`/`folder` — clones a document (and its embedded items/pages). Handy for reskinning an NPC or item.

## Building documents & journals

Construct documents the way Foundry stores them. Inspect an existing document of the same type first
(`get_*`) and copy its shape — fields vary by game system and live under `system.*`.

**JournalEntry structure.** A journal is a container of **pages**, not one blob:

```json
{ "name": "...", "folder": null, "ownership": { "default": 0 }, "pages": [ /* page, page, ... */ ] }
```

Each text page:

```json
{ "type": "text", "name": "<section title>", "title": { "show": true, "level": 1 },
  "text": { "format": 1, "content": "<html>" } }
```

- `format: 1` means HTML — use semantic tags (`<h1>`/`<h2>`, `<p>`, `<ul>`/`<li>`, `<strong>`/`<em>`).
- Prefer **multiple pages** (one per section) over a single giant page — it matches how Foundry renders
  and navigates a journal. Each page's `name` is its sidebar/TOC label.

**Visibility — `ownership.default`** controls who can see a document:

| value | meaning |
|-------|---------|
| `-1`  | inherit |
| `0`   | none — GM-only (use for GM prep / behind-the-screen notes) |
| `2`   | observer — players can read it (player-facing handouts) |
| `3`   | owner |

Set it deliberately rather than relying on the default.

**Fit in, don't impose.** Before creating content, list a few neighbouring documents with `get_*` and
match their structure, naming, and section layout. **Default to semantic HTML** — it always renders via
Foundry core. To match a world's visual style you may reuse the CSS classes/layout you see in existing
entries, but those depend on a **module's stylesheet** (not core), so don't introduce new class-based
styling of your own. World-specific conventions belong in that world's GM-authored `AGENTS` journal —
read it; don't invent your own.

## Actors

Actor-centric helpers (generic / capability-detected — no system-specific schema baked in):

- `create_actor { name, type?, folder?, data? }` — convenience over `create_document` for `Actor`.
- `grant_item { actor, (pack + entry) | item }` — add an item to an actor, imported from a compendium
  or from inline data. (Remove with `delete_embedded` `Item`; edit with `update_embedded`.)
- `list_conditions` — the world's status conditions (ids). `toggle_condition { actor, condition, active? }`
  toggles one (e.g. `"prone"`, `"poisoned"`); omit `active` to flip.
- `get_roll_data { actor }` — the `@`-reference object; feed into `roll_dice` `data` for
  `"1d20+@abilities.dex.mod"`.
- `assign_actor { actor, user, level? }` — set a user's ownership of an actor (give a player their PC).
  `level`: 0 none, 1 limited, 2 observer, 3 owner (default 3).
- `apply_damage` / `apply_healing { actor, amount }` — adjust HP via the system's `applyDamage()`. If the
  system doesn't provide it you'll get `UNAVAILABLE` — adjust the HP field with `modify_document` instead.

## D&D 5e (system adapter)

These `dnd5e_*` tools are **system-aware** and only work when the world runs the **dnd5e** system
(otherwise they return `BAD_REQUEST`). On a 5e world, prefer these over the generic `apply_damage`
because they respect damage types and traits:

- `dnd5e_apply_damage { actor, amount, type?, multiplier? }` — typed damage respecting
  resistances/immunities/vulnerabilities (`type`: e.g. `fire`, `slashing`; `multiplier`: `0.5` half,
  `2` double).
- `dnd5e_apply_healing { actor, amount, temp? }` — heal, or grant temporary HP (`temp: true`).
- `dnd5e_roll { actor, kind, key? }` — `save`/`check` (`key` = ability, e.g. `"dex"`), `skill`
  (`key` = skill code, e.g. `"ath"`), or `death` (no key). Returns the total.
- `dnd5e_rest { actor, type }` — `short` or `long` rest (restores HP/resources).
- `dnd5e_actor_summary { actor }` — compact HP / AC / abilities / level-or-CR readout from the sheet.
- `dnd5e_spell_slots { actor, level, action, amount? }` — `level` 1–9 or `"pact"`; `action`
  `use`/`recover`/`set` (clamped to max).
- `dnd5e_currency { actor, mode, changes }` — `mode` `add`/`set`; `changes` any of pp/gp/ep/sp/cp.
- `dnd5e_award_xp { actor, amount }` — add XP; reports new total, next-level threshold, and
  `levelUpAvailable` (does not auto-level).
- `dnd5e_hit_dice { actor, action, amount? }` — spend/recover pooled hit dice.
- `dnd5e_death_saves { actor, successes?, failures? }` — set the counters (to *roll* a death save use
  `dnd5e_roll kind:"death"`).
- `dnd5e_concentration { actor, action }` — `check` or `break`.

On non-5e worlds, use the generic actor tools (`apply_damage`, `get_roll_data` + `roll_dice`, etc.).

## Embedded documents

Some documents live *inside* a parent: JournalEntry **pages** (`JournalEntryPage`), Actor **items** and
**effects** (`Item`, `ActiveEffect`), Item effects (`ActiveEffect`), Scene placeables (`Token`, `Note`,
`Wall`, …). Edit these **without rewriting the whole parent**:

- `create_embedded` — append e.g. a page to a journal, or items to an actor:
  `{ parent_type, parent_id, embedded, data: [ … ] }`.
- `update_embedded` — edit one in place; each update object must include the embedded `_id`.
- `delete_embedded` — remove by `_id` (destructive tier + bulk limit; permanent).

Prefer these over replacing a parent's whole `pages`/`items` array. Inspect the parent with `get_*`
first to match the embedded document's schema.

The `embedded` name is passed straight to Foundry, so **any** embedded type works — including Scene
placeables and Active Effects. The field shapes below aren't obvious, so they're spelled out:

**Map geometry (parent = a Scene).** Coordinates are scene pixels. As with tokens, create these on the
**active/rendered** scene (see the placeables note under *Scenes & tokens*) — activate the scene first.

- **Walls** — `embedded: "Wall"`, each `{ c: [x0, y0, x1, y1], door, ds, move, sense }`. `c` is the
  segment's endpoints. `door`: `0` none / `1` door / `2` secret. `ds` (door state): `0` closed / `1`
  open / `2` locked. (For batch walls / simple doors, the `draw_walls` tool is easier — see *Scenes*.)
- **Lights** — `embedded: "AmbientLight"`, each `{ x, y, config: { dim, bright, color, alpha, angle } }`
  (`dim`/`bright` are radii in scene units; `color` like `"#ff9900"`).
- **Map notes** — `embedded: "Note"`, each `{ x, y, entryId: "<JournalEntry _id>", text, iconSize }`.
  Links a pin on the map to a journal entry (resolve the journal's `_id` first).
- **Tiles** (`"Tile"`: `{ x, y, width, height, texture: { src } }`) and **Drawings** (`"Drawing"`) work
  the same way. Update/delete by `_id` with `update_embedded`/`delete_embedded`.

**Active Effects / timed buffs (parent = an Actor or Item).** `embedded: "ActiveEffect"`, each:

```json
{ "name": "Bless", "icon": "icons/svg/aura.svg", "disabled": false,
  "duration": { "rounds": 10, "turns": null, "seconds": null },
  "changes": [ { "key": "system.attributes.ac.bonus", "mode": 2, "value": "2" } ] }
```

`duration` can be in `rounds`/`turns` (combat) or `seconds` (world time). `changes[].mode`: `1` multiply,
`2` add, `5` override (most buffs use `2`/add). The `key` path is system-specific — inspect a real effect
on a sheet first. Remove with `delete_embedded` `"ActiveEffect"`; toggle with `update_embedded`
`{ _id, disabled: true|false }`. (For named status conditions like *prone*, prefer `toggle_condition`.)

## Compendia (importing content)

Compendium packs hold reusable content (monsters, spells, items, premade journals) that lives outside
the world until imported.

- `list_compendiums` — available packs (id like `dnd5e.monsters`, label, document type, system);
  optional `type` filter.
- `search_compendium { pack, query? }` — find entries by name; returns `_id`, `name`, `type`, `uuid`, `img`.
- `import_from_compendium { pack, entries: [{ _id|name }], folder? }` — copy entries into the world as
  real documents (optionally into a folder). Imported documents receive fresh `_id`s.

Prefer importing system content over hand-building it. Import first, then inspect/modify the world copy.

## Assets & images

- `browse_files { target, source?, type? }` — list directories/files under a data path (e.g.
  `worlds/<id>/assets`). Discover existing art before uploading duplicates.
- `upload_image { target, filename, data_base64, source? }` — upload a file from base64 into Foundry's
  data storage; returns the stored `path`. Keep files under ~12 MB.
- To use an uploaded asset, set it on a document with `modify_document { img: "<path>" }` (or the
  relevant image field, e.g. a scene background or token texture). No separate tool.

## Folder filing

- `create_folder({type, name, parent?})` creates a folder for documents of `type` (Actor / Item / JournalEntry / Scene). `parent` is an optional folder `_id` for nesting.
- `move_to_folder({type, entity, folder})` files an entity. `folder: null` moves to the root. `entity` and `folder` accept `{_id}` or `{name}`.

## Chat

- `post_chat_message { content, whisper?, blind?, speaker_alias? }` posts to the Foundry chat log.
  By default **everyone** sees it; set `whisper: "gm"` (or a list of `{_id|name}` user refs) to keep it
  private. `speaker_alias` sets the displayed speaker name. Use sparingly — public messages appear live
  in players' chat; prefer a GM whisper unless asked to address the table.

- `get_messages { limit? }` — read the most recent chat messages (alias, text, whisper, timestamp) for
  session context. (The bridge can both post and read chat.)

## Audio

- `play_playlist { playlist }` / `stop_playlist { playlist }` — start/stop a playlist (music, ambiance).
- `play_sound { playlist, sound }` — play one sound within a playlist. Reference by `_id` or `name`.
- `create_playlist { name, mode?, sounds? }` — build a playlist (`mode` 0 sequential / 1 shuffle / 2
  simultaneous / -1 soundboard); each sound is `{ name, path, repeat?, volume? }`.
- `add_playlist_sounds { playlist, sounds }` — add sounds to an existing playlist (remove via
  `delete_embedded` `"PlaylistSound"`).

## Scenes & tokens

- `get_active_scene` — the scene players are currently viewing (id, name, dimensions, token count).
- `activate_scene { ref }` — make a scene the active/viewed one.
- `place_token { actor, x, y, scene?, hidden?, name? }` — drop a token for an actor at pixel `(x, y)`
  on a scene (defaults to the active scene), built from the actor's prototype token.
- `update_token { token_id, updates, scene? }` — move (`{x, y}`), hide (`{hidden:true}`), rename, etc.
  Delete a token with `delete_embedded` (`embedded: "Token"`, parent = the Scene).

Coordinates are scene pixels. Use `get_active_scene` for the scene's dimensions before placing.

> **Placeables target the active scene.** The bridge runs inside a headless Foundry client, and scene
> placeables (tokens, walls, lights, notes, tiles) reliably create only on the **active/rendered** scene
> with a valid grid/dimensions. Building on a non-active scene can stall; if a placeable call returns a
> `TIMEOUT` saying so, **`activate_scene` the target first** (or build on the active scene) rather than
> retrying. Scenes you create via `create_document` need real dimensions + grid before they'll accept
> placeables — set those (and activate) first.

- `update_scene { scene?, updates }` — change a scene's environment/config (e.g. `{ darkness: 0.8 }`,
  grid, weather, background); defaults to the active scene. Inspect with `get_scene` first for paths.
- `reset_fog { scene? }` — clear the fog of war / exploration on a scene.
- `draw_walls { scene?, segments }` — add wall segments in one call. Each segment is
  `{ x1, y1, x2, y2, door?, ds? }` (`door`: 0 none / 1 door / 2 secret; `ds`: 0 closed / 1 open / 2
  locked). Defaults to the active scene. Convenience over `create_embedded` `"Wall"` for blocking
  line-of-sight/movement and adding doors.
- `create_scene { name, width?, height?, grid_size?, grid_type?, padding?, background?, activate? }` —
  make a **placeable-ready** scene (sane grid/dimensions) so you can immediately add walls/tokens/lights.
  Prefer this over `create_document` for scenes — a minimally-built scene stalls on placeable writes.
- `toggle_door { wall_id, state?, scene? }` — open/close/lock a door wall (`state` 0/1/2; omit to flip).
- `place_light { x, y, dim?, bright?, color?, scene? }` and `place_note { x, y, journal, text?,
  icon_size?, scene? }` — typed convenience over `create_embedded` `"AmbientLight"`/`"Note"`. For tiles
  and other placeables, use `create_embedded` (see *Embedded documents → Map geometry*).

## Dice & tables

- `roll_dice { formula, data? }` — evaluate a dice formula (`"2d6+3"`, `"1d20+@abilities.dex.mod"`).
  Returns `total`, the `result` string, and per-die results. Does **not** post to chat.
- `draw_table { table, formula? }` — draw from a RollTable (by `_id`/`name`). Returns the drawn
  result(s) **without** posting to chat or marking them drawn. Use for random encounters/loot/names.

Both are read-only (no side effects). To announce a roll or draw, pass the result to `post_chat_message`
— or use `roll_to_chat { formula, flavor?, whisper? }` which rolls **and** posts a dice card in one step.

Build tables so `draw_table` has content: `create_table { name, formula?, results? }` and
`add_table_results { table, results }` (results are strings or `{text, weight}`; ranges are normalised).

## Combat

- `start_combat { scene? }` — create and activate a combat encounter (defaults to the active scene).
- `add_combatants { tokens, combat? }` — add token `_id`s as combatants (place tokens first with
  `place_token`); defaults to the active combat.
- `roll_initiative { combat?, combatants? }` — roll for `"all"` (default) or an array of combatant `_id`s.
- `advance_combat { action, combat? }` — `"start"` | `"next"` | `"previous"` | `"next_round"` |
  `"previous_round"` | `"end"` (end removes the encounter).
- `set_initiative { combatant, value, combat? }` — set a combatant's initiative.
- `remove_combatant { combatants: [ids], combat? }` — remove combatants from the encounter.
- `add_combatants` accepts `roll_initiative: true` to roll for the just-added combatants in one step.
- `damage_combatant { combatant, amount, type?, combat? }` — apply damage to a combatant's actor (typed
  on 5e). `update_combatant { combatant, defeated?, hidden?, initiative? }` — mark defeated / hide /
  set init. `combatant_condition { combatant, condition, active?, combat? }` — toggle a condition on
  the combatant's actor.

All return combat state: `{ round, turn, combatants:[{ name, initiative, tokenId }] }`. Typical flow:
`start_combat` → `place_token`/`add_combatants` → `roll_initiative` → `advance_combat "start"` → `"next"` …

## Presenting to players

- `show_to_players { image? | journal?, title? }` — pop a shared **image** onto every player's screen,
  or show a **journal** to all players.
- `pull_to_scene { scene }` — pull all players' views to a scene.
- `ping_location { x, y, scene? }` — ping a point on the active scene to draw attention.

## Cards & decks

For worlds that use card stacks (a deck, plus player hands/piles — all `Cards` documents, listed by
`get_cards`). All take stack refs (`_id`/`name`):

- `shuffle_cards { deck }` — shuffle a deck/stack in place.
- `deal_cards { deck, to: [hands], number? }` — deal `number` (default 1) cards from `deck` to each hand.
- `draw_cards { to, from, number? }` — draw into a hand (`to`) from a deck/pile (`from`).
- `pass_cards { from, to, cards: [ids] }` — pass specific cards (by card `_id`) between stacks.
- `reset_cards { deck }` — recall all cards back to the deck (resets the stack).

## Game time

- `advance_time { seconds }` — move the in-game world clock forward (or back, with a negative value).
  Returns the new `worldTime`. Combine with combat for time-of-day, or to tick down effect durations.
- `set_world_time { worldTime }` — set the clock to an absolute time (seconds since the world epoch).

## Macros

- `execute_macro { macro, args? }` — run a stored macro by `_id`/`name`. **Runs arbitrary stored code**,
  so it's gated behind the **destructive** tier (returns `FORBIDDEN` unless that tier is enabled).

## Errors

- `FORBIDDEN` — permission tier, GM gate, or bulk limit.
- `NOT_FOUND` — the document or folder ref didn't resolve. Check the spelling or list to discover the right name.
- `BAD_REQUEST` — invalid params. The error message names the offending field.
- `UNAVAILABLE` — the Foundry module is not currently connected to the bridge. The bridge will reconnect automatically; retry shortly.
- `TIMEOUT` — Foundry didn't answer in time. Some are transient (retry once), but **read the message**:
  canvas/scene ops (placeables, scene/combat activate, present, audio, macro) return a bounded timeout
  with the actual fix (e.g. "activate the target scene first") — act on it rather than blindly retrying.
- `INTERNAL` — something else broke. Report it.

## Operating discipline

- Be conservative. Make minimal, targeted changes.
- Read before writing, even for `modify_document` — schemas vary.
- Respect any GM instructions found in the world.
- All actions appear in Foundry's audit log under the bridge user (typically `mcp-bridge`).

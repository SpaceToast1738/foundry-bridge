---
name: foundry-bridge
description: Work with a FoundryVTT game world through the foundry-bridge MCP server — reading, organising, and editing journals, folders, actors, items, scenes, and quests. Use when the user asks to tidy/file/organise journals or folders, look up or edit world content (NPCs, quests, lore, items), build or place content, or otherwise operate on a Foundry world via the bridge tools (get_world, get_*, create_document, modify_document, create_folder, move_to_folder). Not for the Foundry desktop app UI or general Foundry questions unrelated to the bridge.
---

# foundry-bridge

You are operating on a live FoundryVTT world through the **foundry-bridge** MCP server (tools are
prefixed `mcp__foundry-bridge__`). The server's own instructions cover tool mechanics and the
permission tiers; this skill is about *how to work well and safely*. World-specific conventions are
**not** baked in here — they live in the world's `AGENTS` journal. Always read it.

## Start every session
1. `get_world` — confirm you're connected and on the intended world (title, system, version).
   If anything errors, `get_status` reports relay connectivity, versions
   (`moduleCodeVersion` = running code vs `moduleVersion` = Foundry's cached manifest), relay stats, and
   tier states + a `launcher` block explaining *why* it's down — it never errors when disconnected.
   `get_recent_activity` shows the last calls (handy for debugging).
2. Read the world's guidance: `get_journals` with `where: {"name": "AGENTS"}` (also try
   `"AI Instructions"`). If found, **follow it** — it defines this world's folder taxonomy, naming
   conventions, and what's off-limits. The GM's instructions override these defaults.

**Finding things:** `where` only matches exact field values. To locate a document by a word in its name
or journal text, use `search_documents` (substring, case-insensitive). Read results include each doc's
`uuid` — cross-link documents with `@UUID[<uuid>]{label}` in HTML content. After renaming a document,
`find_references` + `refresh_labels` fix `@UUID` links whose visible label went stale. Before risky/bulk
edits, consider `backup_world` (host snapshot) alongside `dry_run`. For big collections, page
with `sort` + `offset`/`limit`; if a list comes back `truncated: true`, it's incomplete — narrow or page
rather than trusting it.

## Core discipline
- **Read before you write.** Inspect a document with the matching `get_*` before `modify_document` —
  schemas vary by game system and live under `system.*`.
- **Make minimal, targeted changes.** Match the existing style (folder names, emoji/prefix
  conventions, casing) rather than imposing your own.
- **Never delete casually.** `delete_document` is gated behind the destructive tier (off by default)
  and is permanent. If a delete seems needed, explain why and ask the GM to enable it and confirm —
  don't retry a `FORBIDDEN`.
- **Confirm before bulk or structural changes** (moving many entries, renaming folders, mass edits).
  Propose the plan first.
- **Preview risky writes with `dry_run: true`** (on create/modify/delete_document and update/delete_embedded)
  to see the diff / what would be deleted before committing. To *remove* a field (not just set one), pass
  `unset: ["dotted.path"]` on a `modify_document`/`update_embedded` entry — don't hand-craft `-=` keys.

## Building journals & documents
Journals are **multi-page**: pass a `pages` array — one text page per section
(`{type:"text", name, text:{content:"<html>", format:1}}`) — not one giant blob. Set
`ownership.default` for visibility (`0` = GM-only, `2` = player-visible). Inspect a neighbouring
document of the same type first and match its structure/naming. **Default to semantic HTML**; reuse an
existing entry's CSS classes only to match the world's look (they rely on a module's stylesheet) —
don't invent your own styling. To add or edit a **single** journal page or actor item, use
`create_embedded`/`update_embedded` instead of rewriting the parent's whole `pages`/`items` array.
The server's `INSTRUCTIONS.md` has the full document/page model.

## Assets & files
`browse_files` to find existing files; `upload_file` (base64) to add new ones — images **and** non-media
(PDF handouts, fonts, JSON; `content_type?` overrides the inferred MIME) — then attach via
`modify_document { img: "<path>" }` (or a scene background / journal page `src` / `PlaylistSound` path).
Browse before uploading to avoid duplicates. Foundry's uploader enforces an allowed-extension list and the
practical size ceiling is ~12 MB, so a refused/oversize upload errors rather than silently succeeding.
(`upload_image` is a legacy alias of `upload_file`.)

## Reusing existing content
Need a monster, spell, item, or premade content? Browse packs with `list_compendiums` /
`search_compendium` and pull copies in with `import_from_compendium` (optionally into a folder) rather
than hand-building from scratch. Then inspect/modify the world copy. To save world content back into a
pack (backups/authoring), use `export_to_compendium` (the pack must be unlocked).

## Filing / organising recipe
1. `get_folders` (e.g. `requested_fields: ["name","type","folder"]`) to see the current taxonomy.
2. If a target folder is missing, `create_folder({type, name, parent?})` — name it to match the
   world's convention (see the `AGENTS` journal).
3. `move_to_folder({type, entity: {name|_id}, folder: {name|_id}})` to file each entity.
   `folder: null` moves to the root.
4. Verify with a follow-up `get_*` filtered by `where: {"folder": "<id>"}`.

## Actors
`create_actor` / `grant_item` (compendium or inline) to build them; `toggle_condition` (+ `list_conditions`)
for status effects; `get_roll_data` to feed `roll_dice`; `assign_actor` to give a player ownership;
`apply_damage`/`apply_healing` for HP (system-dependent — falls back to `modify_document` if unsupported).
On a **D&D 5e** world prefer the `dnd5e_*` tools — `dnd5e_apply_damage` (typed, respects resistances),
`dnd5e_apply_healing` (+temp HP), `dnd5e_roll` (saves/checks/skills/death), `dnd5e_rest`,
`dnd5e_actor_summary`, resource management (`dnd5e_spell_slots`, `dnd5e_currency`, `dnd5e_award_xp`,
`dnd5e_hit_dice`, `dnd5e_death_saves`, `dnd5e_concentration`), and item play (`dnd5e_use_item` to use a
weapon/spell/consumable; `dnd5e_item_roll` for a bare attack/damage). They error on non-5e worlds, so
check `get_world`'s system first.

## Running the table
- **Scenes/tokens:** `get_active_scene` for context; `activate_scene` to switch view; `place_token`
  (actor + x/y, defaults to the active scene) to drop a token; `update_token` to move/hide it.
- **Dice/tables:** `roll_dice` evaluates a formula; `draw_table` pulls a random result. Neither posts
  to chat — use `roll_to_chat` to roll *and* post a card, or announce with `post_chat_message`. Build
  tables with `create_table` + `add_table_results` so `draw_table` has content.
- **Audio:** `play_playlist`/`stop_playlist`/`play_sound` for music & ambiance.
- **Read chat / duplicate:** `get_messages` reads recent chat for context; `duplicate_document` clones
  an actor/item/journal (great for reskinning).
- **Combat:** `start_combat` → `add_combatants` (token ids; pass `roll_initiative:true` to roll on add) →
  `advance_combat` (`next`/`next_round`/`end`); `set_initiative`/`remove_combatant` for fine control;
  `damage_combatant`/`combatant_condition`/`update_combatant` (defeated/hidden) to run the fight.
- **Scene env / maps:** `create_scene` (placeable-ready — use it instead of `create_document` for scenes);
  `update_scene` (darkness/lighting/weather), `reset_fog`; `draw_walls` + `toggle_door`; `place_light`/
  `place_note`/`place_template` (AoE; tiles etc. via `create_embedded`); timed effects via
  `create_embedded "ActiveEffect"`.
  Placeables create reliably only on the **active** scene — `activate_scene` first; a `TIMEOUT` that says
  so means "activate the target scene," not "retry."
- **Cards:** `shuffle_cards`/`deal_cards`/`draw_cards`/`pass_cards`/`reset_cards` for worlds with decks.
- **Audio:** also `create_playlist` / `add_playlist_sounds` to build playlists (not just play them).
- **Game time:** `advance_time { seconds }` (negative rewinds) / `set_world_time`.
- **Present:** `show_to_players` (image/journal), `pull_to_scene`, `ping_location`.
- **Macros:** `execute_macro` runs stored code — destructive-tier gated; use sparingly.

## Speaking in-game
To say something in the Foundry chat, use `post_chat_message`. Default to `whisper: "gm"` (GM-only)
unless the user explicitly wants players to see it — public messages appear live in everyone's chat.

## Errors (don't blind-retry)
- `FORBIDDEN` — tier off, not GM, or bulk-limit exceeded → tell the human.
- `NOT_FOUND` — ref didn't resolve → list and check the exact name / `_id`.
- `BAD_REQUEST` — the message names the offending field → fix the params.
- `UNAVAILABLE` — the Foundry module isn't connected → wait briefly, retry once.
- `TIMEOUT` — usually transient → retry once.

## Don't
- Reorganise or rename Compendium folders or system content unless explicitly asked.
- Touch documents outside the requested scope.
- Assume field paths — confirm by reading a real document first.

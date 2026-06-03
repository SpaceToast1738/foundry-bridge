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
2. Read the world's guidance: `get_journals` with `where: {"name": "AGENTS"}` (also try
   `"AI Instructions"`). If found, **follow it** — it defines this world's folder taxonomy, naming
   conventions, and what's off-limits. The GM's instructions override these defaults.

**Finding things:** `where` only matches exact field values. To locate a document by a word in its name
or journal text, use `search_documents` (substring, case-insensitive). Read results include each doc's
`uuid` — cross-link documents with `@UUID[<uuid>]{label}` in HTML content.

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

## Building journals & documents
Journals are **multi-page**: pass a `pages` array — one text page per section
(`{type:"text", name, text:{content:"<html>", format:1}}`) — not one giant blob. Set
`ownership.default` for visibility (`0` = GM-only, `2` = player-visible). Inspect a neighbouring
document of the same type first and match its structure/naming. **Default to semantic HTML**; reuse an
existing entry's CSS classes only to match the world's look (they rely on a module's stylesheet) —
don't invent your own styling. To add or edit a **single** journal page or actor item, use
`create_embedded`/`update_embedded` instead of rewriting the parent's whole `pages`/`items` array.
The server's `INSTRUCTIONS.md` has the full document/page model.

## Assets & images
`browse_files` to find existing art; `upload_image` (base64) to add new art, then attach it with
`modify_document { img: "<path>" }`. Browse before uploading to avoid duplicates.

## Reusing existing content
Need a monster, spell, item, or premade content? Browse packs with `list_compendiums` /
`search_compendium` and pull copies in with `import_from_compendium` (optionally into a folder) rather
than hand-building from scratch. Then inspect/modify the world copy.

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

## Running the table
- **Scenes/tokens:** `get_active_scene` for context; `activate_scene` to switch view; `place_token`
  (actor + x/y, defaults to the active scene) to drop a token; `update_token` to move/hide it.
- **Dice/tables:** `roll_dice` evaluates a formula; `draw_table` pulls a random result. Neither posts
  to chat — announce the outcome with `post_chat_message` if the table should see it.
- **Combat:** `start_combat` → `add_combatants` (token ids) → `roll_initiative` → `advance_combat`
  (`next`/`end`). All return the current round/turn/initiative state.

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

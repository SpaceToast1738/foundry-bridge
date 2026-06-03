# foundry-bridge — AI Agent Instructions

You are connected to a FoundryVTT game world via the **foundry-bridge** MCP server. Unlike the older `foundry-mcp`, this bridge speaks to a Foundry **module** running inside a live (headless) Foundry client. Every call goes through Foundry's documented JavaScript SDK — `Folder.create`, `Actor.updateDocuments`, etc. — so it is not coupled to undocumented WebSocket internals.

## Permission tiers

The bridge enforces three tiers, each gated by a world setting in the module:

| Tier | Methods | Default |
|------|---------|---------|
| **read** | `get_world`, `get_*`, `ping` | always on for the GM |
| **write** | `create_*`, `modify_document`, `create_folder`, `move_to_folder` | on |
| **destructive** | `delete_document` | **off** — opt-in per world |

If a tool returns `FORBIDDEN`, the bridge user is not a GM, the relevant tier is off, or a bulk-limit was exceeded. Do not retry — tell the human.

## First steps

1. Run `get_world` to confirm the bridge is connected and you have the right world.
2. Look for a journal entry named `AGENTS`, `AI Instructions`, or similar. Search with `get_journals` using `where: {"name": "AGENTS"}` or list with `requested_fields: ["name"]` and scan. If a GM left instructions there, follow them.

## Reading documents

- List tools per collection: `get_actors`, `get_items`, `get_journals`, `get_folders`, `get_scenes`,
  `get_users`, `get_tables`, `get_playlists`, `get_macros`, `get_cards`, `get_combats`. Use `where` for
  AND-combined **exact-match** filtering and `requested_fields` to project. `max_length` (bytes) trims
  documents from the tail until the JSON fits.
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

## Compendia (importing content)

Compendium packs hold reusable content (monsters, spells, items, premade journals) that lives outside
the world until imported.

- `list_compendiums` — available packs (id like `dnd5e.monsters`, label, document type, system);
  optional `type` filter.
- `search_compendium { pack, query? }` — find entries by name; returns `_id`, `name`, `type`, `uuid`, `img`.
- `import_from_compendium { pack, entries: [{ _id|name }], folder? }` — copy entries into the world as
  real documents (optionally into a folder). Imported documents receive fresh `_id`s.

Prefer importing system content over hand-building it. Import first, then inspect/modify the world copy.

## Folder filing

- `create_folder({type, name, parent?})` creates a folder for documents of `type` (Actor / Item / JournalEntry / Scene). `parent` is an optional folder `_id` for nesting.
- `move_to_folder({type, entity, folder})` files an entity. `folder: null` moves to the root. `entity` and `folder` accept `{_id}` or `{name}`.

## Chat

- `post_chat_message { content, whisper?, blind?, speaker_alias? }` posts to the Foundry chat log.
  By default **everyone** sees it; set `whisper: "gm"` (or a list of `{_id|name}` user refs) to keep it
  private. `speaker_alias` sets the displayed speaker name. Use sparingly — public messages appear live
  in players' chat; prefer a GM whisper unless asked to address the table.

## Scenes & tokens

- `get_active_scene` — the scene players are currently viewing (id, name, dimensions, token count).
- `activate_scene { ref }` — make a scene the active/viewed one.
- `place_token { actor, x, y, scene?, hidden?, name? }` — drop a token for an actor at pixel `(x, y)`
  on a scene (defaults to the active scene), built from the actor's prototype token.
- `update_token { token_id, updates, scene? }` — move (`{x, y}`), hide (`{hidden:true}`), rename, etc.
  Delete a token with `delete_embedded` (`embedded: "Token"`, parent = the Scene).

Coordinates are scene pixels. Use `get_active_scene` for the scene's dimensions before placing.

## Errors

- `FORBIDDEN` — permission tier, GM gate, or bulk limit.
- `NOT_FOUND` — the document or folder ref didn't resolve. Check the spelling or list to discover the right name.
- `BAD_REQUEST` — invalid params. The error message names the offending field.
- `UNAVAILABLE` — the Foundry module is not currently connected to the bridge. The bridge will reconnect automatically; retry shortly.
- `TIMEOUT` — Foundry didn't answer within 30 seconds. Usually transient.
- `INTERNAL` — something else broke. Report it.

## Operating discipline

- Be conservative. Make minimal, targeted changes.
- Read before writing, even for `modify_document` — schemas vary.
- Respect any GM instructions found in the world.
- All actions appear in Foundry's audit log under the bridge user (typically `mcp-bridge`).

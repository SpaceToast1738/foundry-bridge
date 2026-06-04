import { readFileSync } from "node:fs";
import {
  BridgeError,
  ErrorCode,
  Method,
} from "@foundry-bridge/shared";
import {
  getCredentialsInfo,
  type FoundryCredential,
} from "./core/credentials.js";
import type { Relay } from "./relay.js";

/**
 * Read the headless launcher's diagnostics file (best-effort). Lets get_status
 * explain WHY the bridge is down — no world launched, wrong world, bridge user
 * not a GM, login failed — even when the module isn't connected to the relay.
 */
export function readLauncherStatus(): Record<string, unknown> {
  const path =
    process.env.FOUNDRY_BRIDGE_LAUNCHER_STATUS ??
    "/var/lib/foundry-bridge/launcher-status.json";
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return { state: "unknown" };
  }
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const READABLE_COLLECTIONS = [
  { tool: "actors", singular: "actor", collection: "actors" },
  { tool: "items", singular: "item", collection: "items" },
  { tool: "journals", singular: "journal", collection: "journal" },
  { tool: "folders", singular: "folder", collection: "folders" },
  { tool: "scenes", singular: "scene", collection: "scenes" },
  { tool: "users", singular: "user", collection: "users" },
  { tool: "tables", singular: "table", collection: "tables" },
  { tool: "playlists", singular: "playlist", collection: "playlists" },
  { tool: "macros", singular: "macro", collection: "macros" },
  { tool: "cards", singular: "card", collection: "cards" },
  { tool: "combats", singular: "combat", collection: "combats" },
] as const;

const listInputSchema = {
  type: "object",
  properties: {
    where: {
      type: "object",
      additionalProperties: true,
      description:
        "Filter by field values. Conditions are AND-combined. Example: {\"folder\": \"abc\"}.",
    },
    requested_fields: {
      type: "array",
      items: { type: "string" },
      description:
        "Field names to include in each document. _id and name are always included.",
    },
    sort: {
      type: "string",
      description:
        "Field path to sort by before paging, e.g. \"name\" or \"system.cr\". Missing values sort last.",
    },
    sort_dir: {
      type: "string",
      enum: ["asc", "desc"],
      description: "Sort direction (default \"asc\"). Only applies when 'sort' is set.",
    },
    offset: {
      type: "integer",
      description: "Number of matched documents to skip before returning results (for paging).",
    },
    limit: {
      type: "integer",
      description: "Maximum number of documents to return (page size). Use with 'offset' to page.",
    },
    max_length: {
      type: "integer",
      description:
        "Maximum response size in bytes. Documents are removed from the tail until the JSON fits. " +
        "The response sets truncated=true if this dropped any documents — prefer limit/offset paging over a trimmed list.",
    },
  },
  required: [],
} as const;

const docRefSchema = {
  type: "object",
  properties: {
    _id: { type: "string" },
    id: { type: "string" },
    name: { type: "string" },
  },
  description: "Document reference. Provide at least one of _id, id, or name.",
  required: [],
} as const;

const getInputSchema = {
  type: "object",
  properties: {
    _id: { type: "string" },
    id: { type: "string" },
    name: { type: "string" },
    requested_fields: {
      type: "array",
      items: { type: "string" },
      description:
        "Field names to include. _id and name are always included.",
    },
  },
  required: [],
} as const;

const writableTypeProp = {
  type: "string",
  description:
    "Document class name. One of: Actor, Item, JournalEntry, Folder, Scene, User, RollTable, Playlist, Macro, Cards.",
} as const;

const folderableTypeProp = {
  type: "string",
  description:
    "Document class name the folder organises. One of: Actor, Item, JournalEntry, Scene, RollTable, Playlist, Macro, Cards.",
} as const;

export function buildToolDefinitions(): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "get_world",
      description:
        "Get a compact descriptor of the connected world: title, system, version, and per-collection counts.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "ping",
      description: "Health check. Returns { pong: true, timestamp }.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
  ];

  for (const c of READABLE_COLLECTIONS) {
    tools.push({
      name: `get_${c.tool}`,
      description: `List all ${c.tool} in the world.`,
      inputSchema: listInputSchema,
    });
    tools.push({
      name: `get_${c.singular}`,
      description: `Get a single ${c.singular} by _id, id, or name.`,
      inputSchema: getInputSchema,
    });
  }

  tools.push({
    name: "search_documents",
    description:
      "Keyword search across collections by name (and, for journals, page text). Case-insensitive substring match. Returns lightweight hits with _id, name, uuid, and a snippet where text matched. Use this to find a document when you don't know its exact name; use get_* with `where` for exact-field filtering.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for (case-insensitive substring)." },
        collections: {
          type: "array",
          items: { type: "string" },
          description:
            "Collections to search (e.g. [\"journal\",\"actors\"]). Defaults to all readable collections.",
        },
        include_text: {
          type: "boolean",
          description: "Search journal page text in addition to names. Default true.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of hits to return. Default 50.",
        },
      },
      required: ["query"],
    },
  });

  tools.push({
    name: "create_document",
    description:
      "Create one or more documents. Inspect an existing document of the same type with get_* first to learn the system-specific schema.",
    inputSchema: {
      type: "object",
      properties: {
        type: writableTypeProp,
        data: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          description: "Documents to create. At minimum supply a name field.",
        },
      },
      required: ["type", "data"],
    },
  });

  tools.push({
    name: "modify_document",
    description:
      "Apply one or more updates to a document. Each update is deep-merged. Inspect the document first with get_* so the field paths are correct for this game system.",
    inputSchema: {
      type: "object",
      properties: {
        type: writableTypeProp,
        _id: { type: "string", description: "The document's _id." },
        updates: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          description: "Updates to apply in order.",
        },
      },
      required: ["type", "_id", "updates"],
    },
  });

  tools.push({
    name: "delete_document",
    description:
      "Delete one or more documents by _id. Subject to the bridge's destructive-tier toggle and bulk limit.",
    inputSchema: {
      type: "object",
      properties: {
        type: writableTypeProp,
        ids: {
          type: "array",
          items: { type: "string" },
          description: "The _ids to delete.",
        },
      },
      required: ["type", "ids"],
    },
  });

  const embeddedParentProps = {
    parent_type: {
      type: "string",
      description:
        "The parent document's class name (e.g. JournalEntry, Actor, Item, Scene).",
    },
    parent_id: { type: "string", description: "The parent document's _id." },
    embedded: {
      type: "string",
      description:
        "Embedded document class name. Common: JournalEntryPage (in a JournalEntry); Item or ActiveEffect (in an Actor); ActiveEffect (in an Item).",
    },
  } as const;

  tools.push({
    name: "create_embedded",
    description:
      "Add embedded documents to a parent — e.g. append a page to a journal (JournalEntryPage) or add items/effects to an actor — without rewriting the whole parent. Inspect the parent with get_* first to match the embedded schema.",
    inputSchema: {
      type: "object",
      properties: {
        ...embeddedParentProps,
        data: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          description: "Embedded documents to create (at minimum a name).",
        },
      },
      required: ["parent_type", "parent_id", "embedded", "data"],
    },
  });

  tools.push({
    name: "update_embedded",
    description:
      "Update embedded documents in place — e.g. edit a single journal page or one actor item. Each update object must include the embedded document's _id. Inspect the parent first so field paths are correct.",
    inputSchema: {
      type: "object",
      properties: {
        ...embeddedParentProps,
        updates: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          description: "Updates to apply; each must include the embedded `_id`.",
        },
      },
      required: ["parent_type", "parent_id", "embedded", "updates"],
    },
  });

  tools.push({
    name: "delete_embedded",
    description:
      "Delete embedded documents (e.g. a journal page or actor item) by _id. Subject to the destructive tier and bulk limit. Permanent.",
    inputSchema: {
      type: "object",
      properties: {
        ...embeddedParentProps,
        ids: {
          type: "array",
          items: { type: "string" },
          description: "The embedded document _ids to delete.",
        },
      },
      required: ["parent_type", "parent_id", "embedded", "ids"],
    },
  });

  tools.push({
    name: "create_folder",
    description:
      "Create a folder for documents of the given type. Optional parent makes it a nested folder.",
    inputSchema: {
      type: "object",
      properties: {
        type: folderableTypeProp,
        name: { type: "string", description: "Folder name." },
        parent: {
          type: "string",
          description: "Optional parent folder _id for nesting.",
        },
      },
      required: ["type", "name"],
    },
  });

  tools.push({
    name: "move_to_folder",
    description:
      "Move an entity into a folder, or to the root (folder: null). The entity is looked up by _id or name.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Entity type. One of: Actor, Item, JournalEntry, Scene, Folder.",
        },
        entity: docRefSchema,
        folder: {
          type: ["object", "null"],
          properties: {
            _id: { type: "string" },
            id: { type: "string" },
            name: { type: "string" },
          },
          description:
            "Target folder reference by _id or name, or null to move to the root.",
        },
      },
      required: ["type", "entity", "folder"],
    },
  });

  tools.push({
    name: "get_active_scene",
    description:
      "Get the currently active/viewed scene (id, name, dimensions, token count).",
    inputSchema: { type: "object", properties: {}, required: [] },
  });

  tools.push({
    name: "activate_scene",
    description: "Make a scene the active one (what players view). Reference it by _id or name.",
    inputSchema: {
      type: "object",
      properties: { ref: docRefSchema },
      required: ["ref"],
    },
  });

  tools.push({
    name: "place_token",
    description:
      "Place a token for an actor on a scene at (x, y) pixel coordinates, using the actor's prototype token. Defaults to the active scene.",
    inputSchema: {
      type: "object",
      properties: {
        scene: docRefSchema,
        actor: docRefSchema,
        x: { type: "number", description: "X pixel coordinate on the scene." },
        y: { type: "number", description: "Y pixel coordinate on the scene." },
        hidden: { type: "boolean", description: "Place hidden from players." },
        name: { type: "string", description: "Override the token name." },
      },
      required: ["actor", "x", "y"],
    },
  });

  tools.push({
    name: "update_token",
    description:
      "Update a token on a scene by its _id — move it (x/y), hide/reveal (hidden), rename, etc. Defaults to the active scene. Delete a token with delete_embedded (embedded: \"Token\").",
    inputSchema: {
      type: "object",
      properties: {
        scene: docRefSchema,
        token_id: { type: "string", description: "The token's _id on the scene." },
        updates: {
          type: "object",
          additionalProperties: true,
          description: "Fields to update (e.g. { x, y, hidden }).",
        },
      },
      required: ["token_id", "updates"],
    },
  });

  tools.push({
    name: "start_combat",
    description:
      "Create a combat encounter on a scene (defaults to the active scene) and make it the active combat. Returns the combat state.",
    inputSchema: {
      type: "object",
      properties: { scene: docRefSchema },
      required: [],
    },
  });

  tools.push({
    name: "add_combatants",
    description:
      "Add combatants to a combat from token _ids on its scene. Defaults to the active combat. (Place tokens first with place_token.)",
    inputSchema: {
      type: "object",
      properties: {
        combat: docRefSchema,
        tokens: {
          type: "array",
          items: { type: "string" },
          description: "Token _ids to add as combatants.",
        },
      },
      required: ["tokens"],
    },
  });

  tools.push({
    name: "roll_initiative",
    description:
      "Roll initiative in a combat. Defaults to the active combat and all combatants; pass `combatants` (array of combatant _ids) to roll a subset.",
    inputSchema: {
      type: "object",
      properties: {
        combat: docRefSchema,
        combatants: {
          description: "\"all\" (default) or an array of combatant _ids.",
        },
      },
      required: [],
    },
  });

  tools.push({
    name: "advance_combat",
    description:
      "Advance a combat: action \"start\" (begin), \"next\" (next turn), \"previous\" (prior turn), or \"end\" (end the encounter — removes the combat). Defaults to the active combat.",
    inputSchema: {
      type: "object",
      properties: {
        combat: docRefSchema,
        action: {
          type: "string",
          enum: ["start", "next", "previous", "end"],
          description: "What to do.",
        },
      },
      required: ["action"],
    },
  });

  tools.push({
    name: "roll_dice",
    description:
      "Evaluate a Foundry dice formula (e.g. \"2d6+3\", \"1d20+@abilities.dex.mod\"). Returns the total, the rolled result string, and per-die results. Does not post to chat — follow with post_chat_message to announce it.",
    inputSchema: {
      type: "object",
      properties: {
        formula: { type: "string", description: "Dice formula, e.g. \"1d20+5\"." },
        data: {
          type: "object",
          additionalProperties: true,
          description: "Optional roll data for @-references (e.g. an actor's system data).",
        },
      },
      required: ["formula"],
    },
  });

  tools.push({
    name: "draw_table",
    description:
      "Draw a result from a RollTable (by _id or name). Returns the drawn result(s) without posting to chat or marking them drawn. Use for random encounters/loot/names.",
    inputSchema: {
      type: "object",
      properties: {
        table: docRefSchema,
        formula: { type: "string", description: "Optional roll formula override." },
      },
      required: ["table"],
    },
  });

  tools.push({
    name: "list_compendiums",
    description:
      "List the compendium packs available in the world (id, label, document type, system). Optionally filter by document type (e.g. Actor, Item).",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Optional document type filter (e.g. Actor, Item, JournalEntry).",
        },
      },
      required: [],
    },
  });

  tools.push({
    name: "search_compendium",
    description:
      "Search a compendium pack's index by name (substring, case-insensitive). Returns lightweight entries (_id, name, type, uuid, img). Use list_compendiums first to get a pack id.",
    inputSchema: {
      type: "object",
      properties: {
        pack: { type: "string", description: "Pack id, e.g. \"dnd5e.monsters\"." },
        query: { type: "string", description: "Name substring to match. Omit to list the pack." },
        type: { type: "string", description: "Optional entry subtype filter." },
        limit: { type: "integer", description: "Max entries to return. Default 50." },
      },
      required: ["pack"],
    },
  });

  tools.push({
    name: "import_from_compendium",
    description:
      "Import one or more entries from a compendium pack into the world as real documents, optionally into a folder. Entries are referenced by _id or name (use search_compendium to find them).",
    inputSchema: {
      type: "object",
      properties: {
        pack: { type: "string", description: "Pack id, e.g. \"dnd5e.monsters\"." },
        entries: {
          type: "array",
          items: docRefSchema,
          description: "Entries to import, each referenced by _id or name.",
        },
        folder: {
          description: "Optional destination folder: an _id string, or a {_id|name} reference.",
        },
      },
      required: ["pack", "entries"],
    },
  });

  tools.push({
    name: "post_chat_message",
    description:
      "Post a message to the Foundry chat log. By default visible to everyone; set whisper to \"gm\" (or a list of user refs) to restrict it. Use sparingly — it appears live in players' chat unless whispered.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Message HTML/text." },
        whisper: {
          description:
            "Optional. \"gm\" to whisper all GMs, or an array of {_id|name} user references.",
        },
        blind: { type: "boolean", description: "Optional. Hide the message from its author." },
        speaker_alias: {
          type: "string",
          description: "Optional display name for the speaker.",
        },
      },
      required: ["content"],
    },
  });

  tools.push({
    name: "browse_files",
    description:
      "List directories and files under a path in Foundry's data storage (e.g. \"worlds/<id>/assets\"). Use to discover existing art before uploading or referencing it.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Directory path to browse (\"\" for the root)." },
        source: { type: "string", description: "Storage source; defaults to \"data\"." },
        type: { type: "string", description: "Filter, e.g. \"image\", \"audio\". Optional." },
      },
      required: ["target"],
    },
  });

  tools.push({
    name: "upload_image",
    description:
      "Upload a file (image/audio/etc.) to Foundry's data storage from base64 data. Returns the stored path, which you can set as a document image via modify_document { img: <path> }. Keep files under ~12 MB.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Destination directory, e.g. \"worlds/<id>/assets/avatars\"." },
        filename: { type: "string", description: "Filename including extension, e.g. \"goblin.png\"." },
        data_base64: { type: "string", description: "Base64-encoded file contents." },
        source: { type: "string", description: "Storage source; defaults to \"data\"." },
      },
      required: ["target", "filename", "data_base64"],
    },
  });

  tools.push({
    name: "create_actor",
    description:
      "Create an actor (character/NPC/monster). Convenience over create_document. Inspect an existing actor of the same type first for the system schema.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Actor name." },
        type: { type: "string", description: "Actor subtype for the game system (e.g. \"npc\", \"character\")." },
        folder: { type: "string", description: "Optional folder _id." },
        data: { type: "object", additionalProperties: true, description: "Optional extra fields (e.g. system data)." },
      },
      required: ["name"],
    },
  });

  tools.push({
    name: "grant_item",
    description:
      "Add an item to an actor — either imported from a compendium (pack + entry) or from inline data (item). Provide exactly one source.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        pack: { type: "string", description: "Compendium pack id (with `entry`)." },
        entry: docRefSchema,
        item: { type: "object", additionalProperties: true, description: "Inline item data (with at least a name)." },
      },
      required: ["actor"],
    },
  });

  tools.push({
    name: "list_conditions",
    description:
      "List the status conditions available in this world (id, name, img) from the system's status effects.",
    inputSchema: { type: "object", properties: {}, required: [] },
  });

  tools.push({
    name: "toggle_condition",
    description:
      "Toggle a status condition on an actor (e.g. \"prone\", \"poisoned\"). Pass `active` to force on/off, or omit to flip. Use list_conditions for valid ids.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        condition: { type: "string", description: "Condition id (see list_conditions)." },
        active: { type: "boolean", description: "Force on (true) / off (false); omit to toggle." },
      },
      required: ["actor", "condition"],
    },
  });

  tools.push({
    name: "get_roll_data",
    description:
      "Get an actor's roll data (the @-reference object), so roll_dice can use formulas like \"1d20+@abilities.dex.mod\".",
    inputSchema: {
      type: "object",
      properties: { actor: docRefSchema },
      required: ["actor"],
    },
  });

  tools.push({
    name: "assign_actor",
    description:
      "Set a user's ownership of an actor (e.g. give a player control of their PC). level: 0 none, 1 limited, 2 observer, 3 owner (default 3).",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        user: docRefSchema,
        level: { type: "integer", description: "Ownership level 0-3 (default 3 = owner)." },
      },
      required: ["actor", "user"],
    },
  });

  tools.push({
    name: "apply_damage",
    description:
      "Apply damage to an actor (reduces HP). System-dependent: uses the actor's applyDamage(); if unsupported, adjust HP with modify_document instead.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        amount: { type: "number", description: "Damage amount (positive)." },
      },
      required: ["actor", "amount"],
    },
  });

  tools.push({
    name: "apply_healing",
    description:
      "Heal an actor (restores HP). System-dependent: uses the actor's applyDamage() with a negative amount; if unsupported, adjust HP with modify_document instead.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        amount: { type: "number", description: "Healing amount (positive)." },
      },
      required: ["actor", "amount"],
    },
  });

  const tableResultsProp = {
    type: "array",
    items: {
      oneOf: [
        { type: "string" },
        { type: "object", properties: { text: { type: "string" }, weight: { type: "integer" } }, required: ["text"] },
      ],
    },
    description: "Results: strings, or { text, weight }.",
  } as const;

  tools.push({
    name: "create_table",
    description:
      "Create a RollTable, optionally with a roll formula and initial results. Results are normalised (ranges assigned). Then draw_table can roll on it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Table name." },
        folder: { type: "string", description: "Optional folder _id." },
        formula: { type: "string", description: "Optional roll formula, e.g. \"1d20\". Defaults from result count." },
        results: tableResultsProp,
      },
      required: ["name"],
    },
  });

  tools.push({
    name: "add_table_results",
    description: "Add results to an existing RollTable (by _id or name) and re-normalise the ranges.",
    inputSchema: {
      type: "object",
      properties: { table: docRefSchema, results: tableResultsProp },
      required: ["table", "results"],
    },
  });

  tools.push({
    name: "play_playlist",
    description: "Start playing a playlist (all its sounds, per the playlist's mode). Reference by _id or name.",
    inputSchema: { type: "object", properties: { playlist: docRefSchema }, required: ["playlist"] },
  });

  tools.push({
    name: "stop_playlist",
    description: "Stop a playlist (all its sounds). Reference by _id or name.",
    inputSchema: { type: "object", properties: { playlist: docRefSchema }, required: ["playlist"] },
  });

  tools.push({
    name: "play_sound",
    description: "Play a single sound within a playlist. Reference the playlist and the sound by _id or name.",
    inputSchema: {
      type: "object",
      properties: { playlist: docRefSchema, sound: docRefSchema },
      required: ["playlist", "sound"],
    },
  });

  const playlistSoundSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      path: { type: "string", description: "Audio file path." },
      repeat: { type: "boolean" },
      volume: { type: "number", minimum: 0, maximum: 1, description: "0–1 (default 0.5)." },
    },
    required: ["name", "path"],
  } as const;

  tools.push({
    name: "create_playlist",
    description:
      "Create a playlist, optionally with sounds. `mode`: 0 sequential (default), 1 shuffle, 2 simultaneous, -1 soundboard. Each sound is {name, path, repeat?, volume?}.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        mode: { type: "integer", enum: [-1, 0, 1, 2] },
        sounds: { type: "array", items: playlistSoundSchema },
      },
      required: ["name"],
    },
  });

  tools.push({
    name: "add_playlist_sounds",
    description:
      "Add sounds to an existing playlist (by `_id`/`name`). Each sound is {name, path, repeat?, volume?}. Remove with delete_embedded \"PlaylistSound\".",
    inputSchema: {
      type: "object",
      properties: {
        playlist: docRefSchema,
        sounds: { type: "array", items: playlistSoundSchema },
      },
      required: ["playlist", "sounds"],
    },
  });

  tools.push({
    name: "get_messages",
    description:
      "Read the most recent chat-log messages (default 20): _id, speaker alias, text content, whisper targets, timestamp. Use for session context.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many recent messages (default 20)." } },
      required: [],
    },
  });

  tools.push({
    name: "roll_to_chat",
    description:
      "Roll a dice formula and post the result as a chat card (with optional flavor). whisper \"gm\" or a list of user refs keeps it private. Unlike roll_dice, this posts to chat.",
    inputSchema: {
      type: "object",
      properties: {
        formula: { type: "string", description: "Dice formula, e.g. \"1d20+5\"." },
        flavor: { type: "string", description: "Optional label shown on the roll card." },
        whisper: { description: "Optional. \"gm\" or an array of {_id|name} user refs." },
      },
      required: ["formula"],
    },
  });

  tools.push({
    name: "duplicate_document",
    description:
      "Clone an existing document (Actor/Item/JournalEntry/Scene/etc.) — copies embedded items/pages too. Optional new name (default \"… (Copy)\") and destination folder.",
    inputSchema: {
      type: "object",
      properties: {
        type: writableTypeProp,
        ref: docRefSchema,
        name: { type: "string", description: "Name for the copy." },
        folder: { type: "string", description: "Optional destination folder _id." },
      },
      required: ["type", "ref"],
    },
  });

  // --- D&D 5e system adapter (only functional on a dnd5e world) ---
  tools.push({
    name: "dnd5e_apply_damage",
    description:
      "[D&D 5e] Apply typed damage to an actor, respecting resistances/immunities/vulnerabilities. `type` is a 5e damage type (e.g. fire, slashing); `multiplier` scales it. Only works on a dnd5e world.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        amount: { type: "number", description: "Damage amount (positive)." },
        type: { type: "string", description: "5e damage type, e.g. \"fire\", \"slashing\". Omit for untyped." },
        multiplier: { type: "number", description: "Scale (e.g. 0.5 for half, 2 for double). Default 1." },
      },
      required: ["actor", "amount"],
    },
  });

  tools.push({
    name: "dnd5e_apply_healing",
    description:
      "[D&D 5e] Heal an actor, or grant temporary HP when `temp` is true. Only works on a dnd5e world.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        amount: { type: "number", description: "Amount (positive)." },
        temp: { type: "boolean", description: "Grant temporary HP instead of healing." },
      },
      required: ["actor", "amount"],
    },
  });

  tools.push({
    name: "dnd5e_roll",
    description:
      "[D&D 5e] Roll for an actor: kind \"save\"/\"check\" (key = ability, e.g. \"dex\"), \"skill\" (key = skill, e.g. \"ath\"), or \"death\" (no key). Returns the total. Only works on a dnd5e world.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        kind: { type: "string", enum: ["save", "check", "skill", "death"] },
        key: { type: "string", description: "Ability (str/dex/…) or skill code (ath/acr/…). Not needed for death saves." },
      },
      required: ["actor", "kind"],
    },
  });

  tools.push({
    name: "dnd5e_rest",
    description:
      "[D&D 5e] Take a short or long rest for an actor (restores HP/resources). Only works on a dnd5e world.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        type: { type: "string", enum: ["short", "long"] },
      },
      required: ["actor", "type"],
    },
  });

  tools.push({
    name: "dnd5e_actor_summary",
    description:
      "[D&D 5e] Compact sheet readout for an actor: HP (value/max/temp), AC, abilities (value+mod), level/CR. Only works on a dnd5e world.",
    inputSchema: {
      type: "object",
      properties: { actor: docRefSchema },
      required: ["actor"],
    },
  });

  tools.push({
    name: "dnd5e_spell_slots",
    description:
      "[D&D 5e] Adjust an actor's spell slots. `level` 1–9 or \"pact\"; `action` use/recover/set; `amount` (default 1). Clamped to max. Returns the level's value/max.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        level: { description: "Spell level 1–9, or \"pact\".", anyOf: [{ type: "integer", minimum: 1, maximum: 9 }, { type: "string", enum: ["pact"] }] },
        action: { type: "string", enum: ["use", "recover", "set"] },
        amount: { type: "integer", description: "Slots to use/recover, or the value to set (default 1)." },
      },
      required: ["actor", "level", "action"],
    },
  });

  tools.push({
    name: "dnd5e_currency",
    description:
      "[D&D 5e] Adjust an actor's coins. `mode` add (delta, may be negative) or set (absolute); `changes` is any of pp/gp/ep/sp/cp. Returns the new currency.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        mode: { type: "string", enum: ["add", "set"] },
        changes: {
          type: "object",
          properties: {
            pp: { type: "integer" }, gp: { type: "integer" }, ep: { type: "integer" },
            sp: { type: "integer" }, cp: { type: "integer" },
          },
          additionalProperties: false,
        },
      },
      required: ["actor", "mode", "changes"],
    },
  });

  tools.push({
    name: "dnd5e_award_xp",
    description:
      "[D&D 5e] Add (or remove, if negative) XP for an actor. Returns new xp, the next-level threshold, and whether a level-up is available (does not auto-level).",
    inputSchema: {
      type: "object",
      properties: { actor: docRefSchema, amount: { type: "integer" } },
      required: ["actor", "amount"],
    },
  });

  tools.push({
    name: "dnd5e_hit_dice",
    description:
      "[D&D 5e] Spend/recover an actor's hit dice (pooled system.attributes.hd). `amount` default 1. UNAVAILABLE if the version tracks HD per class item — use modify_document then.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        action: { type: "string", enum: ["spend", "recover"] },
        amount: { type: "integer", minimum: 1 },
      },
      required: ["actor", "action"],
    },
  });

  tools.push({
    name: "dnd5e_death_saves",
    description:
      "[D&D 5e] Set an actor's death-save counters (`successes` and/or `failures`, 0–3). For rolling a death save use dnd5e_roll kind=death.",
    inputSchema: {
      type: "object",
      properties: {
        actor: docRefSchema,
        successes: { type: "integer", minimum: 0, maximum: 3 },
        failures: { type: "integer", minimum: 0, maximum: 3 },
      },
      required: ["actor"],
    },
  });

  tools.push({
    name: "dnd5e_concentration",
    description:
      "[D&D 5e] `check` whether an actor is concentrating, or `break` their concentration (ends the concentration effect).",
    inputSchema: {
      type: "object",
      properties: { actor: docRefSchema, action: { type: "string", enum: ["check", "break"] } },
      required: ["actor", "action"],
    },
  });

  tools.push({
    name: "show_to_players",
    description:
      "Show content to all players: an `image` (path → popout on everyone's screen) or a `journal` (by `_id`/`name`). Optional `title`.",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "Image path to share (popout)." },
        journal: docRefSchema,
        title: { type: "string", description: "Optional popout title." },
      },
      required: [],
    },
  });

  tools.push({
    name: "pull_to_scene",
    description: "Pull all players' views to a scene (by `_id`/`name`).",
    inputSchema: { type: "object", properties: { scene: docRefSchema }, required: ["scene"] },
  });

  tools.push({
    name: "ping_location",
    description: "Ping a point on the active scene's canvas at pixel `(x, y)` to draw players' attention.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        scene: docRefSchema,
      },
      required: ["x", "y"],
    },
  });

  tools.push({
    name: "update_scene",
    description:
      "Update a scene's environment/config (defaults to the active scene): e.g. `{ darkness: 0.8 }`, grid, weather, background. Inspect the scene with get_scene first for field paths.",
    inputSchema: {
      type: "object",
      properties: {
        scene: docRefSchema,
        updates: { type: "object", additionalProperties: true, description: "Fields to update." },
      },
      required: ["updates"],
    },
  });

  tools.push({
    name: "reset_fog",
    description: "Reset (clear) the fog of war / exploration on a scene (defaults to the active scene).",
    inputSchema: { type: "object", properties: { scene: docRefSchema }, required: [] },
  });

  tools.push({
    name: "set_initiative",
    description: "Set a combatant's initiative value in a combat (defaults to the active combat).",
    inputSchema: {
      type: "object",
      properties: {
        combat: docRefSchema,
        combatant: { type: "string", description: "Combatant _id." },
        value: { type: "number", description: "Initiative value." },
      },
      required: ["combatant", "value"],
    },
  });

  tools.push({
    name: "remove_combatant",
    description: "Remove combatants from a combat by their _id(s) (defaults to the active combat).",
    inputSchema: {
      type: "object",
      properties: {
        combat: docRefSchema,
        combatants: { type: "array", items: { type: "string" }, description: "Combatant _ids to remove." },
      },
      required: ["combatants"],
    },
  });

  tools.push({
    name: "execute_macro",
    description:
      "Run a stored macro by `_id`/`name`, optionally passing a `scope` object. Runs arbitrary stored code — gated behind the destructive tier.",
    inputSchema: {
      type: "object",
      properties: {
        macro: docRefSchema,
        args: { type: "object", additionalProperties: true, description: "Optional scope passed to the macro." },
      },
      required: ["macro"],
    },
  });

  tools.push({
    name: "get_status",
    description:
      "Health & diagnostics: whether a Foundry client is connected to the bridge relay, the module version, the world (title/system/version/counts), and the read/write/destructive tier states. Safe to call any time — returns { relayConnected:false } instead of erroring when no client is connected.",
    inputSchema: { type: "object", properties: {}, required: [] },
  });

  tools.push({
    name: "deal_cards",
    description:
      "Deal cards from a deck to one or more hands/piles. `deck` and each `to` entry are card-stack refs (_id/name); `number` per hand (default 1).",
    inputSchema: {
      type: "object",
      properties: {
        deck: docRefSchema,
        to: { type: "array", items: docRefSchema, description: "Hand/pile stacks to deal to." },
        number: { type: "integer", description: "Cards to deal to each hand (default 1)." },
      },
      required: ["deck", "to"],
    },
  });

  tools.push({
    name: "draw_cards",
    description:
      "Draw cards into a hand (`to`) from a deck/pile (`from`). Both are card-stack refs; `number` (default 1).",
    inputSchema: {
      type: "object",
      properties: {
        to: docRefSchema,
        from: docRefSchema,
        number: { type: "integer", description: "Cards to draw (default 1)." },
      },
      required: ["to", "from"],
    },
  });

  tools.push({
    name: "shuffle_cards",
    description: "Shuffle a card stack (deck) in place. `deck` is a card-stack ref.",
    inputSchema: { type: "object", properties: { deck: docRefSchema }, required: ["deck"] },
  });

  tools.push({
    name: "pass_cards",
    description:
      "Pass specific cards from one stack to another. `from`/`to` are card-stack refs; `cards` is an array of card _ids.",
    inputSchema: {
      type: "object",
      properties: {
        from: docRefSchema,
        to: docRefSchema,
        cards: { type: "array", items: { type: "string" }, description: "Card _ids to pass." },
      },
      required: ["from", "to", "cards"],
    },
  });

  tools.push({
    name: "reset_cards",
    description: "Reset a card stack — recall all its cards back to the deck. `deck` is a card-stack ref.",
    inputSchema: { type: "object", properties: { deck: docRefSchema }, required: ["deck"] },
  });

  tools.push({
    name: "advance_time",
    description:
      "Advance (or rewind) the in-game world clock by `seconds` (negative rewinds). Returns the new worldTime.",
    inputSchema: {
      type: "object",
      properties: { seconds: { type: "integer", description: "Seconds to advance; may be negative." } },
      required: ["seconds"],
    },
  });

  tools.push({
    name: "set_world_time",
    description: "Set the in-game world clock to an absolute `worldTime` (seconds since the world epoch).",
    inputSchema: {
      type: "object",
      properties: { worldTime: { type: "integer", description: "Absolute world time in seconds (>=0)." } },
      required: ["worldTime"],
    },
  });

  tools.push({
    name: "draw_walls",
    description:
      "Add wall segments to a scene (defaults to the active scene). Each segment is pixel coords {x1,y1,x2,y2}; optional `door` (0 none, 1 door, 2 secret) and `ds` (door state: 0 closed, 1 open, 2 locked). Good for blocking line-of-sight/movement and adding doors.",
    inputSchema: {
      type: "object",
      properties: {
        scene: docRefSchema,
        segments: {
          type: "array",
          description: "Wall segments to create.",
          items: {
            type: "object",
            properties: {
              x1: { type: "number" },
              y1: { type: "number" },
              x2: { type: "number" },
              y2: { type: "number" },
              door: { type: "integer", enum: [0, 1, 2] },
              ds: { type: "integer", enum: [0, 1, 2] },
            },
            required: ["x1", "y1", "x2", "y2"],
          },
        },
      },
      required: ["segments"],
    },
  });

  tools.push({
    name: "create_scene",
    description:
      "Create a placeable-ready scene with sane defaults (grid + dimensions) so you can immediately add walls/tokens/lights without it stalling. Optional `background` (image path), `grid_size`/`grid_type`, `padding`, and `activate` (make it the active/viewed scene).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        width: { type: "integer", description: "Scene width in pixels (default 4000)." },
        height: { type: "integer", description: "Scene height in pixels (default 3000)." },
        grid_size: { type: "integer", description: "Grid square size in pixels (default 100, min 50)." },
        grid_type: { type: "integer", description: "0 gridless, 1 square (default), 2-5 hex variants." },
        padding: { type: "number", description: "Edge padding fraction 0–0.5 (default 0.25)." },
        background: { type: "string", description: "Background image path." },
        activate: { type: "boolean", description: "Activate (view) the scene after creating it." },
      },
      required: ["name"],
    },
  });

  tools.push({
    name: "toggle_door",
    description:
      "Open/close/lock a wall that is a door. `wall_id` is the Wall _id; `state` 0 closed, 1 open, 2 locked (omit to flip open↔closed). Defaults to the active scene.",
    inputSchema: {
      type: "object",
      properties: {
        scene: docRefSchema,
        wall_id: { type: "string", description: "Wall document _id (must be a door)." },
        state: { type: "integer", enum: [0, 1, 2], description: "0 closed, 1 open, 2 locked." },
      },
      required: ["wall_id"],
    },
  });

  tools.push({
    name: "place_light",
    description:
      "Place an ambient light at pixel (x, y) on a scene (default active). `dim`/`bright` radii (scene units), `color` like \"#ffaa33\". Convenience over create_embedded \"AmbientLight\".",
    inputSchema: {
      type: "object",
      properties: {
        scene: docRefSchema,
        x: { type: "number" },
        y: { type: "number" },
        dim: { type: "number", description: "Dim light radius." },
        bright: { type: "number", description: "Bright light radius." },
        color: { type: "string", description: "Light color, e.g. \"#ffaa33\"." },
      },
      required: ["x", "y"],
    },
  });

  tools.push({
    name: "place_note",
    description:
      "Drop a map note pin at (x, y) linking a journal entry (`journal` ref). Optional `text` label + `icon_size`. Default active scene. Convenience over create_embedded \"Note\".",
    inputSchema: {
      type: "object",
      properties: {
        scene: docRefSchema,
        x: { type: "number" },
        y: { type: "number" },
        journal: docRefSchema,
        text: { type: "string", description: "Label shown on the pin." },
        icon_size: { type: "integer", description: "Pin icon size in pixels." },
      },
      required: ["x", "y", "journal"],
    },
  });

  tools.push({
    name: "show_credentials",
    description:
      "List the Foundry credentials this bridge is configured with. Passwords are never returned.",
    inputSchema: { type: "object", properties: {}, required: [] },
  });

  return tools;
}

export interface ToolContext {
  relay: Relay;
  credentials: FoundryCredential[];
  activeIndex: number;
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: ToolContext,
): Promise<unknown> {
  const params = args ?? {};
  switch (name) {
    case "get_world":
      return ctx.relay.call(Method.WORLD_GET, {});
    case "ping":
      return ctx.relay.call(Method.PING, {});
    case "search_documents":
      return ctx.relay.call(Method.DOCUMENTS_SEARCH, params);
    case "create_document":
      return ctx.relay.call(Method.DOCUMENTS_CREATE, params);
    case "modify_document":
      return ctx.relay.call(Method.DOCUMENTS_UPDATE, params);
    case "delete_document":
      return ctx.relay.call(Method.DOCUMENTS_DELETE, params);
    case "create_embedded":
      return ctx.relay.call(Method.EMBEDDED_CREATE, params);
    case "update_embedded":
      return ctx.relay.call(Method.EMBEDDED_UPDATE, params);
    case "delete_embedded":
      return ctx.relay.call(Method.EMBEDDED_DELETE, params);
    case "create_folder":
      return ctx.relay.call(Method.FOLDERS_CREATE, params);
    case "move_to_folder":
      return ctx.relay.call(Method.FOLDERS_MOVE, params);
    case "list_compendiums":
      return ctx.relay.call(Method.COMPENDIUM_LIST, params);
    case "search_compendium":
      return ctx.relay.call(Method.COMPENDIUM_SEARCH, params);
    case "import_from_compendium":
      return ctx.relay.call(Method.COMPENDIUM_IMPORT, params);
    case "browse_files":
      return ctx.relay.call(Method.FILES_BROWSE, params);
    case "upload_image":
      return ctx.relay.call(Method.FILES_UPLOAD, params);
    case "create_actor":
      return ctx.relay.call(Method.ACTOR_CREATE, params);
    case "grant_item":
      return ctx.relay.call(Method.ACTOR_GRANT_ITEM, params);
    case "list_conditions":
      return ctx.relay.call(Method.CONDITIONS_LIST, params);
    case "toggle_condition":
      return ctx.relay.call(Method.ACTOR_TOGGLE_CONDITION, params);
    case "get_roll_data":
      return ctx.relay.call(Method.ACTOR_ROLL_DATA, params);
    case "assign_actor":
      return ctx.relay.call(Method.ACTOR_ASSIGN, params);
    case "apply_damage":
      return ctx.relay.call(Method.ACTOR_APPLY_DAMAGE, params);
    case "apply_healing":
      return ctx.relay.call(Method.ACTOR_APPLY_HEALING, params);
    case "dnd5e_apply_damage":
      return ctx.relay.call(Method.DND5E_APPLY_DAMAGE, params);
    case "dnd5e_apply_healing":
      return ctx.relay.call(Method.DND5E_APPLY_HEALING, params);
    case "dnd5e_roll":
      return ctx.relay.call(Method.DND5E_ROLL, params);
    case "dnd5e_rest":
      return ctx.relay.call(Method.DND5E_REST, params);
    case "dnd5e_actor_summary":
      return ctx.relay.call(Method.DND5E_ACTOR_SUMMARY, params);
    case "dnd5e_spell_slots":
      return ctx.relay.call(Method.DND5E_SPELL_SLOTS, params);
    case "dnd5e_currency":
      return ctx.relay.call(Method.DND5E_CURRENCY, params);
    case "dnd5e_award_xp":
      return ctx.relay.call(Method.DND5E_AWARD_XP, params);
    case "dnd5e_hit_dice":
      return ctx.relay.call(Method.DND5E_HIT_DICE, params);
    case "dnd5e_death_saves":
      return ctx.relay.call(Method.DND5E_DEATH_SAVES, params);
    case "dnd5e_concentration":
      return ctx.relay.call(Method.DND5E_CONCENTRATION, params);
    case "create_table":
      return ctx.relay.call(Method.TABLE_CREATE, params);
    case "add_table_results":
      return ctx.relay.call(Method.TABLE_ADD_RESULTS, params);
    case "play_playlist":
      return ctx.relay.call(Method.PLAYLIST_PLAY, params);
    case "stop_playlist":
      return ctx.relay.call(Method.PLAYLIST_STOP, params);
    case "play_sound":
      return ctx.relay.call(Method.PLAYLIST_PLAY_SOUND, params);
    case "create_playlist":
      return ctx.relay.call(Method.PLAYLIST_CREATE, params);
    case "add_playlist_sounds":
      return ctx.relay.call(Method.PLAYLIST_ADD_SOUNDS, params);
    case "get_messages":
      return ctx.relay.call(Method.MESSAGES_LIST, params);
    case "roll_to_chat":
      return ctx.relay.call(Method.DICE_ROLL_TO_CHAT, params);
    case "duplicate_document":
      return ctx.relay.call(Method.DOCUMENTS_DUPLICATE, params);
    case "show_to_players":
      return ctx.relay.call(Method.PRESENT_SHOW, params);
    case "pull_to_scene":
      return ctx.relay.call(Method.PRESENT_PULL, params);
    case "ping_location":
      return ctx.relay.call(Method.PRESENT_PING, params);
    case "update_scene":
      return ctx.relay.call(Method.SCENE_UPDATE, params);
    case "reset_fog":
      return ctx.relay.call(Method.SCENE_RESET_FOG, params);
    case "set_initiative":
      return ctx.relay.call(Method.COMBAT_SET_INITIATIVE, params);
    case "remove_combatant":
      return ctx.relay.call(Method.COMBAT_REMOVE, params);
    case "execute_macro":
      return ctx.relay.call(Method.MACRO_EXECUTE, params);
    case "get_status": {
      // Health tool: must answer even when no Foundry client is connected,
      // so don't go through relay.call (which throws UNAVAILABLE). Always attach
      // the launcher diagnostics so the caller can see WHY it's down.
      const launcher = readLauncherStatus();
      if (!ctx.relay.isConnected()) {
        return { relayConnected: false, launcher };
      }
      const status = (await ctx.relay.call(Method.STATUS_GET, {})) as Record<string, unknown>;
      return { relayConnected: true, ...status, launcher };
    }
    case "deal_cards":
      return ctx.relay.call(Method.CARDS_DEAL, params);
    case "draw_cards":
      return ctx.relay.call(Method.CARDS_DRAW, params);
    case "shuffle_cards":
      return ctx.relay.call(Method.CARDS_SHUFFLE, params);
    case "pass_cards":
      return ctx.relay.call(Method.CARDS_PASS, params);
    case "reset_cards":
      return ctx.relay.call(Method.CARDS_RESET, params);
    case "advance_time":
      return ctx.relay.call(Method.TIME_ADVANCE, params);
    case "set_world_time":
      return ctx.relay.call(Method.TIME_SET, params);
    case "draw_walls":
      return ctx.relay.call(Method.WALLS_DRAW, params);
    case "create_scene":
      return ctx.relay.call(Method.SCENE_CREATE, params);
    case "toggle_door":
      return ctx.relay.call(Method.DOOR_TOGGLE, params);
    case "place_light":
      return ctx.relay.call(Method.LIGHT_PLACE, params);
    case "place_note":
      return ctx.relay.call(Method.NOTE_PLACE, params);
    case "post_chat_message":
      return ctx.relay.call(Method.MESSAGES_CREATE, params);
    case "get_active_scene":
      return ctx.relay.call(Method.SCENE_ACTIVE, params);
    case "activate_scene":
      return ctx.relay.call(Method.SCENE_ACTIVATE, params);
    case "place_token":
      return ctx.relay.call(Method.TOKEN_PLACE, params);
    case "update_token":
      return ctx.relay.call(Method.TOKEN_UPDATE, params);
    case "start_combat":
      return ctx.relay.call(Method.COMBAT_CREATE, params);
    case "add_combatants":
      return ctx.relay.call(Method.COMBAT_ADD, params);
    case "roll_initiative":
      return ctx.relay.call(Method.COMBAT_ROLL_INITIATIVE, params);
    case "advance_combat":
      return ctx.relay.call(Method.COMBAT_ADVANCE, params);
    case "roll_dice":
      return ctx.relay.call(Method.DICE_ROLL, params);
    case "draw_table": {
      const { table, ...rest } = params as Record<string, unknown>;
      return ctx.relay.call(Method.TABLE_DRAW, { ref: table, ...rest });
    }
    case "show_credentials":
      return getCredentialsInfo(ctx.credentials, ctx.activeIndex);
  }

  for (const c of READABLE_COLLECTIONS) {
    if (name === `get_${c.tool}`) {
      return ctx.relay.call(Method.DOCUMENTS_LIST, {
        collection: c.collection,
        ...params,
      });
    }
    if (name === `get_${c.singular}`) {
      const { requested_fields, ...rest } = params as Record<string, unknown>;
      return ctx.relay.call(Method.DOCUMENTS_GET, {
        collection: c.collection,
        ref: rest,
        requested_fields,
      });
    }
  }

  throw new BridgeError(ErrorCode.BAD_REQUEST, `Unknown tool '${name}'`);
}

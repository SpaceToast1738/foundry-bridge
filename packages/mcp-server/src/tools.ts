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
    max_length: {
      type: "integer",
      description:
        "Maximum response size in bytes. Documents are removed from the tail until the JSON fits.",
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
    case "post_chat_message":
      return ctx.relay.call(Method.MESSAGES_CREATE, params);
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

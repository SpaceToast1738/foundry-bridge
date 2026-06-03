import { z } from "zod";

export const Method = {
  PING: "ping",
  WORLD_GET: "world.get",
  DOCUMENTS_LIST: "documents.list",
  DOCUMENTS_GET: "documents.get",
  DOCUMENTS_SEARCH: "documents.search",
  DOCUMENTS_CREATE: "documents.create",
  DOCUMENTS_UPDATE: "documents.update",
  DOCUMENTS_DELETE: "documents.delete",
  EMBEDDED_CREATE: "embedded.create",
  EMBEDDED_UPDATE: "embedded.update",
  EMBEDDED_DELETE: "embedded.delete",
  COMPENDIUM_LIST: "compendium.list",
  COMPENDIUM_SEARCH: "compendium.search",
  COMPENDIUM_IMPORT: "compendium.import",
  FOLDERS_CREATE: "folders.create",
  FOLDERS_MOVE: "folders.move",
  MESSAGES_CREATE: "messages.create",
  SCENE_ACTIVE: "scene.active",
  SCENE_ACTIVATE: "scene.activate",
  TOKEN_PLACE: "token.place",
  TOKEN_UPDATE: "token.update",
} as const;

export type Method = (typeof Method)[keyof typeof Method];

export const methodSchema = z.enum([
  Method.PING,
  Method.WORLD_GET,
  Method.DOCUMENTS_LIST,
  Method.DOCUMENTS_GET,
  Method.DOCUMENTS_SEARCH,
  Method.DOCUMENTS_CREATE,
  Method.DOCUMENTS_UPDATE,
  Method.DOCUMENTS_DELETE,
  Method.EMBEDDED_CREATE,
  Method.EMBEDDED_UPDATE,
  Method.EMBEDDED_DELETE,
  Method.COMPENDIUM_LIST,
  Method.COMPENDIUM_SEARCH,
  Method.COMPENDIUM_IMPORT,
  Method.FOLDERS_CREATE,
  Method.FOLDERS_MOVE,
  Method.MESSAGES_CREATE,
  Method.SCENE_ACTIVE,
  Method.SCENE_ACTIVATE,
  Method.TOKEN_PLACE,
  Method.TOKEN_UPDATE,
]);

export const PermissionTier = {
  READ: "read",
  WRITE: "write",
  DESTRUCTIVE: "destructive",
} as const;

export type PermissionTier = (typeof PermissionTier)[keyof typeof PermissionTier];

export const METHOD_TIERS: Record<Method, PermissionTier> = {
  [Method.PING]: PermissionTier.READ,
  [Method.WORLD_GET]: PermissionTier.READ,
  [Method.DOCUMENTS_LIST]: PermissionTier.READ,
  [Method.DOCUMENTS_GET]: PermissionTier.READ,
  [Method.DOCUMENTS_SEARCH]: PermissionTier.READ,
  [Method.DOCUMENTS_CREATE]: PermissionTier.WRITE,
  [Method.DOCUMENTS_UPDATE]: PermissionTier.WRITE,
  [Method.FOLDERS_CREATE]: PermissionTier.WRITE,
  [Method.FOLDERS_MOVE]: PermissionTier.WRITE,
  [Method.EMBEDDED_CREATE]: PermissionTier.WRITE,
  [Method.EMBEDDED_UPDATE]: PermissionTier.WRITE,
  [Method.COMPENDIUM_LIST]: PermissionTier.READ,
  [Method.COMPENDIUM_SEARCH]: PermissionTier.READ,
  [Method.COMPENDIUM_IMPORT]: PermissionTier.WRITE,
  [Method.MESSAGES_CREATE]: PermissionTier.WRITE,
  [Method.SCENE_ACTIVE]: PermissionTier.READ,
  [Method.SCENE_ACTIVATE]: PermissionTier.WRITE,
  [Method.TOKEN_PLACE]: PermissionTier.WRITE,
  [Method.TOKEN_UPDATE]: PermissionTier.WRITE,
  [Method.DOCUMENTS_DELETE]: PermissionTier.DESTRUCTIVE,
  [Method.EMBEDDED_DELETE]: PermissionTier.DESTRUCTIVE,
};

const docRefSchema = z
  .object({
    _id: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((v) => v._id || v.id || v.name, {
    message: "Document reference requires _id, id, or name",
  });

export const paramSchemas = {
  [Method.PING]: z.object({}).optional(),
  [Method.WORLD_GET]: z.object({}).optional(),
  [Method.DOCUMENTS_LIST]: z.object({
    collection: z.string().min(1),
    where: z.record(z.string(), z.unknown()).optional(),
    requested_fields: z.array(z.string()).optional(),
    max_length: z.number().int().positive().optional(),
  }),
  [Method.DOCUMENTS_GET]: z.object({
    collection: z.string().min(1),
    ref: docRefSchema,
    requested_fields: z.array(z.string()).optional(),
  }),
  [Method.DOCUMENTS_SEARCH]: z.object({
    query: z.string().min(1),
    collections: z.array(z.string().min(1)).optional(),
    include_text: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
  }),
  [Method.DOCUMENTS_CREATE]: z.object({
    type: z.string().min(1),
    data: z.array(z.record(z.string(), z.unknown())).min(1),
  }),
  [Method.DOCUMENTS_UPDATE]: z.object({
    type: z.string().min(1),
    _id: z.string().min(1),
    updates: z.array(z.record(z.string(), z.unknown())).min(1),
  }),
  [Method.DOCUMENTS_DELETE]: z.object({
    type: z.string().min(1),
    ids: z.array(z.string().min(1)).min(1),
  }),
  [Method.EMBEDDED_CREATE]: z.object({
    parent_type: z.string().min(1),
    parent_id: z.string().min(1),
    embedded: z.string().min(1),
    data: z.array(z.record(z.string(), z.unknown())).min(1),
  }),
  [Method.EMBEDDED_UPDATE]: z.object({
    parent_type: z.string().min(1),
    parent_id: z.string().min(1),
    embedded: z.string().min(1),
    updates: z.array(z.record(z.string(), z.unknown())).min(1),
  }),
  [Method.EMBEDDED_DELETE]: z.object({
    parent_type: z.string().min(1),
    parent_id: z.string().min(1),
    embedded: z.string().min(1),
    ids: z.array(z.string().min(1)).min(1),
  }),
  [Method.COMPENDIUM_LIST]: z
    .object({ type: z.string().min(1).optional() })
    .optional(),
  [Method.COMPENDIUM_SEARCH]: z.object({
    pack: z.string().min(1),
    query: z.string().optional(),
    type: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
  }),
  [Method.COMPENDIUM_IMPORT]: z.object({
    pack: z.string().min(1),
    entries: z.array(docRefSchema).min(1),
    folder: z.union([z.string().min(1), docRefSchema]).optional(),
  }),
  [Method.FOLDERS_CREATE]: z.object({
    type: z.string().min(1),
    name: z.string().min(1),
    parent: z.string().min(1).optional(),
  }),
  [Method.FOLDERS_MOVE]: z.object({
    type: z.string().min(1),
    entity: docRefSchema,
    folder: z.union([docRefSchema, z.null()]),
  }),
  [Method.MESSAGES_CREATE]: z.object({
    content: z.string().min(1),
    whisper: z.union([z.literal("gm"), z.array(docRefSchema)]).optional(),
    blind: z.boolean().optional(),
    speaker_alias: z.string().min(1).optional(),
  }),
  [Method.SCENE_ACTIVE]: z.object({}).optional(),
  [Method.SCENE_ACTIVATE]: z.object({ ref: docRefSchema }),
  [Method.TOKEN_PLACE]: z.object({
    scene: docRefSchema.optional(),
    actor: docRefSchema,
    x: z.number(),
    y: z.number(),
    hidden: z.boolean().optional(),
    name: z.string().min(1).optional(),
  }),
  [Method.TOKEN_UPDATE]: z.object({
    scene: docRefSchema.optional(),
    token_id: z.string().min(1),
    updates: z.record(z.string(), z.unknown()),
  }),
} as const satisfies Record<Method, z.ZodTypeAny>;

export type ParamsFor<M extends Method> = z.infer<(typeof paramSchemas)[M]>;

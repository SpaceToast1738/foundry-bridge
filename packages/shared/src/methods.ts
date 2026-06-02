import { z } from "zod";

export const Method = {
  PING: "ping",
  WORLD_GET: "world.get",
  DOCUMENTS_LIST: "documents.list",
  DOCUMENTS_GET: "documents.get",
  DOCUMENTS_CREATE: "documents.create",
  DOCUMENTS_UPDATE: "documents.update",
  DOCUMENTS_DELETE: "documents.delete",
  FOLDERS_CREATE: "folders.create",
  FOLDERS_MOVE: "folders.move",
} as const;

export type Method = (typeof Method)[keyof typeof Method];

export const methodSchema = z.enum([
  Method.PING,
  Method.WORLD_GET,
  Method.DOCUMENTS_LIST,
  Method.DOCUMENTS_GET,
  Method.DOCUMENTS_CREATE,
  Method.DOCUMENTS_UPDATE,
  Method.DOCUMENTS_DELETE,
  Method.FOLDERS_CREATE,
  Method.FOLDERS_MOVE,
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
  [Method.DOCUMENTS_CREATE]: PermissionTier.WRITE,
  [Method.DOCUMENTS_UPDATE]: PermissionTier.WRITE,
  [Method.FOLDERS_CREATE]: PermissionTier.WRITE,
  [Method.FOLDERS_MOVE]: PermissionTier.WRITE,
  [Method.DOCUMENTS_DELETE]: PermissionTier.DESTRUCTIVE,
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
} as const satisfies Record<Method, z.ZodTypeAny>;

export type ParamsFor<M extends Method> = z.infer<(typeof paramSchemas)[M]>;

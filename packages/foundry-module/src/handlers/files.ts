import {
  BridgeError,
  ErrorCode,
  Method,
  type ParamsFor,
} from "@foundry-bridge/shared";

interface FilePickerClass {
  browse(
    source: string,
    target: string,
    options?: Record<string, unknown>,
  ): Promise<{ target: string; dirs: string[]; files: string[] }>;
  upload(
    source: string,
    target: string,
    file: File,
    body?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ path?: string } | false>;
}

/** v13/v14 moved FilePicker under foundry.applications.apps; fall back to the global. */
function getFilePicker(): FilePickerClass {
  const g = globalThis as Record<string, unknown>;
  const namespaced = (
    g.foundry as { applications?: { apps?: { FilePicker?: unknown } } } | undefined
  )?.applications?.apps?.FilePicker;
  const cls = (namespaced ?? g.FilePicker) as FilePickerClass | undefined;
  if (!cls || typeof cls.browse !== "function" || typeof cls.upload !== "function") {
    throw new BridgeError(ErrorCode.UNAVAILABLE, "FilePicker is not available");
  }
  return cls;
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  webm: "video/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  // Non-media. Foundry's FilePicker enforces its own upload allow-list, so some
  // of these may be refused for non-admins — but when accepted the file carries
  // a sensible MIME type instead of a generic octet-stream.
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export async function handleFilesBrowse(
  params: ParamsFor<typeof Method.FILES_BROWSE>,
): Promise<Record<string, unknown>> {
  const fp = getFilePicker();
  const source = params.source ?? "data";
  const options = params.type ? { type: params.type } : {};
  const res = await fp.browse(source, params.target, options);
  return { target: res.target, dirs: res.dirs, files: res.files };
}

export async function handleFilesUpload(
  params: ParamsFor<typeof Method.FILES_UPLOAD>,
): Promise<Record<string, unknown>> {
  const fp = getFilePicker();
  const source = params.source ?? "data";

  let buffer: ArrayBuffer;
  try {
    const binary = atob(params.data_base64);
    buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  } catch {
    throw new BridgeError(ErrorCode.BAD_REQUEST, "data_base64 is not valid base64");
  }

  const file = new File([buffer], params.filename, {
    type: params.content_type ?? contentTypeFor(params.filename),
  });
  const res = await fp.upload(source, params.target, file, {}, { notify: false });
  if (res === false) {
    throw new BridgeError(ErrorCode.INTERNAL, "Upload failed");
  }
  return { path: res.path ?? `${params.target}/${params.filename}` };
}

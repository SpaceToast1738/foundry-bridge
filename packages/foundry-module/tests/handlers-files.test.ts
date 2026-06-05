import { handleFilesBrowse, handleFilesUpload } from "../src/handlers/files";

interface Uploaded {
  source: string;
  target: string;
  name: string;
  size: number;
  type: string;
}

function installFilePicker(captured: { uploads: Uploaded[] }) {
  (globalThis as Record<string, unknown>).FilePicker = {
    browse: async (_source: string, target: string) => ({
      target,
      dirs: [`${target}/sub`],
      files: [`${target}/a.png`, `${target}/b.jpg`],
    }),
    upload: async (
      source: string,
      target: string,
      file: File,
    ) => {
      captured.uploads.push({
        source,
        target,
        name: file.name,
        size: file.size,
        type: file.type,
      });
      return { path: `${target}/${file.name}` };
    },
  };
}

describe("file handlers", () => {
  const captured = { uploads: [] as Uploaded[] };
  beforeEach(() => {
    captured.uploads = [];
    installFilePicker(captured);
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).FilePicker;
  });

  it("browses a directory", async () => {
    const res = await handleFilesBrowse({ target: "worlds/x/assets" });
    expect(res).toMatchObject({ target: "worlds/x/assets" });
    expect((res.files as string[]).length).toBe(2);
  });

  it("uploads a base64 file and returns the path", async () => {
    const data_base64 = Buffer.from("hello-png-bytes").toString("base64");
    const res = await handleFilesUpload({
      target: "worlds/x/assets/avatars",
      filename: "goblin.png",
      data_base64,
    });
    expect(res).toMatchObject({ path: "worlds/x/assets/avatars/goblin.png" });
    expect(captured.uploads[0]).toMatchObject({
      target: "worlds/x/assets/avatars",
      name: "goblin.png",
    });
    expect(captured.uploads[0].size).toBeGreaterThan(0);
  });

  it("infers a MIME type from the extension for non-image files", async () => {
    const data_base64 = Buffer.from("%PDF-1.4 fake").toString("base64");
    await handleFilesUpload({
      target: "worlds/x/handouts",
      filename: "map-key.pdf",
      data_base64,
    });
    expect(captured.uploads[0]).toMatchObject({
      name: "map-key.pdf",
      type: "application/pdf",
    });
  });

  it("honors an explicit content_type override", async () => {
    const data_base64 = Buffer.from("{}").toString("base64");
    await handleFilesUpload({
      target: "worlds/x/data",
      filename: "weird.dat",
      data_base64,
      content_type: "application/json",
    });
    expect(captured.uploads[0]).toMatchObject({
      name: "weird.dat",
      type: "application/json",
    });
  });

  it("BAD_REQUEST on invalid base64", async () => {
    await expect(
      handleFilesUpload({ target: "t", filename: "x.png", data_base64: "!!!not base64!!!" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("UNAVAILABLE when FilePicker is missing", async () => {
    delete (globalThis as Record<string, unknown>).FilePicker;
    await expect(handleFilesBrowse({ target: "t" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});

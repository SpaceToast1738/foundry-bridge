#!/usr/bin/env node
import { build } from "esbuild";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");
const dist = resolve(root, "dist");

async function readManifest() {
  const raw = await readFile(resolve(root, "src", "module.json"), "utf-8");
  return JSON.parse(raw);
}

async function main() {
  await mkdir(dist, { recursive: true });
  const manifest = await readManifest();

  await build({
    entryPoints: [resolve(root, "src", "main.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    outfile: resolve(dist, "main.js"),
    sourcemap: "linked",
    legalComments: "none",
    // Foundry's `Hooks`, `game`, `ui`, document classes are runtime globals.
    define: {
      "process.env.NODE_ENV": "\"production\"",
      // Baked from the manifest so get_status can report the ACTUALLY-running
      // code version (Foundry caches module.json's version at server boot).
      __BRIDGE_MODULE_VERSION__: JSON.stringify(manifest.version),
    },
  });

  await copyFile(
    resolve(root, "src", "module.json"),
    resolve(dist, "module.json"),
  );

  console.log(
    `[foundry-bridge] bundled module id=${manifest.id} version=${manifest.version} -> ${dist}`,
  );
}

main().catch((err) => {
  console.error("[foundry-bridge] bundle failed:", err);
  process.exit(1);
});

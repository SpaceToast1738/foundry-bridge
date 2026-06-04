#!/usr/bin/env node
// Stamp the module manifest for a tagged release.
// Sets `version` from the tag and points `manifest`/`download` at the release assets.
// Env: RELEASE_VERSION (e.g. "0.2.0"), RELEASE_TAG (e.g. "v0.2.0"),
//      GITHUB_REPOSITORY (e.g. "owner/repo").
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.env.RELEASE_VERSION;
const tag = process.env.RELEASE_TAG;
const repo = process.env.GITHUB_REPOSITORY;

if (!version || !tag || !repo) {
  console.error(
    "prepare-release: RELEASE_VERSION, RELEASE_TAG and GITHUB_REPOSITORY are required",
  );
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "packages/foundry-module/src/module.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
manifest.version = version;
const base = `https://github.com/${repo}/releases`;
// Foundry checks the latest-release manifest for updates; download is pinned to this tag.
manifest.manifest = `${base}/latest/download/module.json`;
manifest.download = `${base}/download/${tag}/foundry-bridge.zip`;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `prepare-release: module.json version=${version} download=${manifest.download}`,
);

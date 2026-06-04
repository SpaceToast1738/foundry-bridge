#!/usr/bin/env node
// Post-`dist` sanity check: the installable module bundle is complete and its
// manifest version matches source. Catches the "redeploy shipped a stale
// module.json / missing main.js" foot-gun before it reaches Foundry.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "packages/foundry-module/dist");
const required = ["main.js", "main.js.map", "module.json"];

const problems = [];
for (const f of required) {
  if (!existsSync(resolve(distDir, f))) problems.push(`missing ${f} in dist/`);
}

if (!problems.length) {
  const srcManifest = JSON.parse(
    readFileSync(resolve(root, "packages/foundry-module/src/module.json"), "utf-8"),
  );
  const distManifest = JSON.parse(
    readFileSync(resolve(distDir, "module.json"), "utf-8"),
  );
  if (!distManifest.version) problems.push("dist/module.json has no version");
  if (srcManifest.version !== distManifest.version) {
    problems.push(
      `version mismatch: src=${srcManifest.version} dist=${distManifest.version} (re-run dist)`,
    );
  }
}

if (problems.length) {
  console.error("[check-dist] FAILED:\n  - " + problems.join("\n  - "));
  process.exit(1);
}
const v = JSON.parse(readFileSync(resolve(distDir, "module.json"), "utf-8")).version;
console.log(`[check-dist] ok — module bundle complete, version ${v}`);

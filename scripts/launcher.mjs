#!/usr/bin/env node
/**
 * Headless Foundry launcher. Logs into the live world as the configured
 * `mcp-bridge` user and keeps the page open. The foundry-bridge module,
 * installed in the world, dials the loopback MCP relay (default
 * ws://127.0.0.1:31414) once Foundry is ready.
 *
 * Env vars:
 *   FOUNDRY_CREDENTIALS                Path to the credentials JSON (default /etc/foundry-bridge/credentials.json)
 *   FOUNDRY_BRIDGE_CREDENTIAL_ID       Which entry to use; defaults to the first
 *   PLAYWRIGHT_USER_DATA_DIR           Chromium profile dir (default /var/lib/foundry-bridge/profile)
 *   FOUNDRY_BRIDGE_HEADLESS            "false" to launch headed for debugging (default true)
 *   FOUNDRY_BRIDGE_RELOAD_INTERVAL_MS  How often to verify the world is still loaded (default 60000)
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const CREDENTIALS_PATH =
  process.env.FOUNDRY_CREDENTIALS ?? "/etc/foundry-bridge/credentials.json";
const USER_DATA_DIR =
  process.env.PLAYWRIGHT_USER_DATA_DIR ?? "/var/lib/foundry-bridge/profile";
const ACTIVE_ID = process.env.FOUNDRY_BRIDGE_CREDENTIAL_ID;
const HEADLESS = process.env.FOUNDRY_BRIDGE_HEADLESS !== "false";
const RELOAD_INTERVAL_MS = Number(
  process.env.FOUNDRY_BRIDGE_RELOAD_INTERVAL_MS ?? 60_000,
);

function log(level, msg) {
  console.error(`[launcher][${level}] ${msg}`);
}

function loadActiveCredential() {
  const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
  const all = JSON.parse(raw);
  if (!Array.isArray(all) || all.length === 0) {
    throw new Error(`No credentials in ${CREDENTIALS_PATH}`);
  }
  const active = ACTIVE_ID
    ? all.find((c) => c._id === ACTIVE_ID)
    : all[0];
  if (!active) {
    throw new Error(
      `No credential matched FOUNDRY_BRIDGE_CREDENTIAL_ID=${ACTIVE_ID}`,
    );
  }
  for (const field of ["hostname", "userid", "password"]) {
    if (typeof active[field] !== "string") {
      throw new Error(`Credential is missing string field '${field}'`);
    }
  }
  return active;
}

/**
 * Foundry v13/v14 join flow. Selectors verified against vanilla v14.363.
 * If a third-party login overlay (e.g. ForgeVTT) is in play these will need
 * tweaks — the launcher logs and retries instead of crashing.
 */
async function joinWorld(page, cred) {
  const joinUrl = `https://${cred.hostname}/join`;
  log("info", `navigating to ${joinUrl}`);
  await page.goto(joinUrl, { waitUntil: "domcontentloaded" });

  const currentUrl = page.url();
  if (currentUrl.includes("/game")) {
    log("info", "already in /game (cookie session reused)");
    return;
  }

  // The v14 join page is an SPA shell — the form is rendered after the
  // initial HTML response, so we explicitly wait for the userid select
  // before reading it. If the world is on the Setup screen instead we'll
  // hit the timeout and surface a clear error.
  const userSelect = page.locator('select[name="userid"]');
  try {
    await userSelect.waitFor({ state: "attached", timeout: 15_000 });
  } catch {
    log("warn", `select[name="userid"] never rendered on /join (15s)`);
    throw new Error(
      "Foundry /join form did not expose a userid select (world may not be running, or selector changed)",
    );
  }
  await userSelect.selectOption(cred.userid);

  const passwordField = page.locator('input[name="password"]');
  if (await passwordField.count()) {
    await passwordField.fill(cred.password);
  }

  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game$/, { timeout: 30_000 });
  log("info", "joined world");
}

async function isInGame(page) {
  return /\/game$/.test(page.url());
}

async function waitForBridgeReady(page) {
  // Module logs `[foundry-bridge] connected to ...` on first relay open.
  // We don't strictly need it before declaring success — the page loaded
  // is enough — but it's a useful signal for the systemd journal.
  await page
    .waitForEvent("console", {
      predicate: (msg) =>
        msg.text().includes("[foundry-bridge] connected"),
      timeout: 30_000,
    })
    .catch(() => {
      log("warn", "did not observe `[foundry-bridge] connected` console log within 30s — module may still come up later");
    });
}

async function main() {
  const cred = loadActiveCredential();
  log("info", `using credential _id=${cred._id} host=${cred.hostname}`);

  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = browser.pages()[0] ?? (await browser.newPage());

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith("[foundry-bridge]")) {
      log("module", text);
    }
  });
  page.on("pageerror", (err) => {
    log("error", `pageerror: ${err.message}`);
  });

  await joinWorld(page, cred);
  await waitForBridgeReady(page);

  const shutdown = async (signal) => {
    log("info", `received ${signal}, closing browser`);
    try {
      await browser.close();
    } catch (err) {
      log("warn", `close error: ${err.message}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Heartbeat: if Foundry drops to /setup or /join, restart the join flow.
  const interval = setInterval(async () => {
    if (!(await isInGame(page))) {
      log("warn", `page left /game (${page.url()}), re-joining`);
      try {
        await joinWorld(page, cred);
      } catch (err) {
        log("error", `re-join failed: ${err.message}`);
      }
    }
  }, RELOAD_INTERVAL_MS);
  interval.unref?.();
}

main().catch((err) => {
  console.error("[launcher][fatal]", err);
  process.exit(1);
});

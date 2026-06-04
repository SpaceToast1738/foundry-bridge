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
 *   FOUNDRY_BRIDGE_LAUNCHER_STATUS     Path to the diagnostics JSON the mcp-server's get_status reads
 *                                      (default /var/lib/foundry-bridge/launcher-status.json)
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const CREDENTIALS_PATH =
  process.env.FOUNDRY_CREDENTIALS ?? "/etc/foundry-bridge/credentials.json";
const USER_DATA_DIR =
  process.env.PLAYWRIGHT_USER_DATA_DIR ?? "/var/lib/foundry-bridge/profile";
const ACTIVE_ID = process.env.FOUNDRY_BRIDGE_CREDENTIAL_ID;
const HEADLESS = process.env.FOUNDRY_BRIDGE_HEADLESS !== "false";
const RELOAD_INTERVAL_MS = Number(
  process.env.FOUNDRY_BRIDGE_RELOAD_INTERVAL_MS ?? 60_000,
);
// Diagnostics the mcp-server's get_status reads so the health tool can explain
// WHY the bridge is down (no world / wrong world / non-GM / login fail) even
// when the module isn't connected to the relay.
const STATUS_PATH =
  process.env.FOUNDRY_BRIDGE_LAUNCHER_STATUS ??
  "/var/lib/foundry-bridge/launcher-status.json";

function log(level, msg) {
  console.error(`[launcher][${level}] ${msg}`);
}

const status = {
  state: "starting",
  lastError: null,
  currentWorld: null,
  username: null,
  isGM: null,
  availableUsers: null,
};

/** Merge a partial update into the launcher status and persist it (best-effort). */
function writeStatus(partial) {
  Object.assign(status, partial, { ts: Date.now() });
  try {
    writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  } catch (err) {
    log("warn", `could not write status file ${STATUS_PATH}: ${err.message}`);
  }
}

/** Read the live world title + GM flag from the page (best-effort). */
async function readGameInfo(page) {
  try {
    return await page.evaluate(() => ({
      currentWorld: globalThis.game?.world?.title ?? null,
      isGM: Boolean(globalThis.game?.user?.isGM),
    }));
  } catch {
    return {};
  }
}

function loadActiveCredential() {
  const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
  const all = JSON.parse(raw);
  if (!Array.isArray(all) || all.length === 0) {
    throw new Error(`No credentials in ${CREDENTIALS_PATH}`);
  }
  let active = ACTIVE_ID ? all.find((c) => c._id === ACTIVE_ID) : all[0];
  // Tolerant selection: if an explicit id was set but didn't match and there's
  // only one credential, use it rather than crash-looping on a label mismatch.
  if (!active && ACTIVE_ID && all.length === 1) {
    log(
      "warn",
      `FOUNDRY_BRIDGE_CREDENTIAL_ID='${ACTIVE_ID}' did not match; using the only credential (_id='${all[0]._id}')`,
    );
    active = all[0];
  }
  if (!active) {
    throw new Error(
      `No credential matched FOUNDRY_BRIDGE_CREDENTIAL_ID='${ACTIVE_ID}' (have: ${all
        .map((c) => `'${c._id}'`)
        .join(", ")})`,
    );
  }
  for (const field of ["hostname", "password"]) {
    if (typeof active[field] !== "string") {
      throw new Error(`Credential is missing string field '${field}'`);
    }
  }
  // Identify the user by display name(s) — `username` (string) or `usernames`
  // (array of candidates, first present in the launched world wins). Names are
  // stable across worlds, so the same bot name in every world lets the bridge
  // follow whichever world is launched. `userid` (the user document _id) is a
  // brittle fallback — it's regenerated whenever a world is rebuilt.
  active.usernames = Array.isArray(active.usernames)
    ? active.usernames.filter((n) => typeof n === "string")
    : typeof active.username === "string"
      ? [active.username]
      : [];
  if (active.usernames.length === 0 && typeof active.userid !== "string") {
    throw new Error(
      "Credential needs a 'username'/'usernames' (preferred) or 'userid' field",
    );
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
    const msg =
      "Foundry /join form did not expose a userid select (world may not be running, or selector changed)";
    writeStatus({ state: "no_world", lastError: msg, currentWorld: null, isGM: null });
    throw new Error(msg);
  }
  // Enumerate the dropdown up front so we can match by display name (stable
  // across worlds) and, on a miss, say exactly which users *are* available —
  // no opaque 30s selectOption timeout.
  const options = await userSelect
    .locator("option")
    .evaluateAll((els) =>
      els
        .map((e) => ({ value: e.value, label: (e.textContent || "").trim() }))
        .filter((o) => o.value),
    );
  let chosen;
  let chosenName;
  for (const name of cred.usernames) {
    const match = options.find((o) => o.label === name);
    if (match) {
      chosen = match.value;
      chosenName = name;
      log("info", `matched bridge user by name '${name}'`);
      break;
    }
  }
  if (!chosen && typeof cred.userid === "string") {
    const match = options.find((o) => o.value === cred.userid);
    if (match) {
      chosen = match.value;
      log("info", `matched bridge user by userid '${cred.userid}' (label '${match.label}')`);
    }
  }
  if (!chosen) {
    const want = cred.usernames.length
      ? `username(s) ${cred.usernames.map((n) => `'${n}'`).join("/")}`
      : `userid '${cred.userid}'`;
    log(
      "error",
      `bridge user ${want} not found in the launched world; available users: ${JSON.stringify(options)}`,
    );
    const available = options.map((o) => o.label).filter(Boolean);
    const info = await readGameInfo(page);
    writeStatus({
      state: "login_failed",
      lastError: `Configured bridge user (${want}) is not in the launched world.`,
      availableUsers: available,
      currentWorld: info.currentWorld ?? null,
      isGM: null,
    });
    throw new Error(
      `Configured bridge user (${want}) is not in the launched world. ` +
        `Available: ${available.join(", ") || "(none — is a world launched?)"}. ` +
        "Create a GM user with one of those names in every world you want the bridge to manage.",
    );
  }
  await userSelect.selectOption(chosen);
  writeStatus({ state: "joining", username: chosenName ?? null, lastError: null });

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
  writeStatus({ state: "starting" });
  const cred = loadActiveCredential();
  const matchBy = cred.usernames.length
    ? `username(s) ${cred.usernames.join("/")}`
    : `userid ${cred.userid}`;
  log("info", `using credential _id=${cred._id} host=${cred.hostname} match-by ${matchBy}`);

  const relayOrigin = process.env.FOUNDRY_BRIDGE_RELAY_ORIGIN ??
    "http://127.0.0.1:31414";

  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Foundry's page is HTTPS; the loopback relay is plain ws://. Without
      // these the handshake is blocked by either mixed-content or Foundry's
      // own connect-src CSP. The Chromium instance here is headless and
      // bot-only, so the wider "disable-web-security" is acceptable.
      `--unsafely-treat-insecure-origin-as-secure=${relayOrigin}`,
      "--disable-features=BlockInsecurePrivateNetworkRequests",
      "--disable-web-security",
    ],
  });
  const page = browser.pages()[0] ?? (await browser.newPage());

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith("[foundry-bridge]")) {
      log("module", text);
      // The module's own ready hook tells us GM vs non-GM; reflect it in status.
      if (text.includes("connected")) {
        void readGameInfo(page).then((info) =>
          writeStatus({ state: "connected", isGM: true, lastError: null, ...info }),
        );
      } else if (text.includes("non-GM")) {
        void readGameInfo(page).then((info) =>
          writeStatus({
            state: "non_gm",
            isGM: false,
            lastError: "Bridge user is not a GM in this world; the module disabled itself.",
            ...info,
          }),
        );
      }
    } else if (msg.type() === "error") {
      log("page-error", text.slice(0, 300));
    }
  });
  page.on("pageerror", (err) => {
    log("error", `pageerror: ${err.message}`);
  });
  // Diagnostic: surface failing network requests (URL + reason) so we can
  // see what the page keeps retrying. Set FOUNDRY_BRIDGE_LOG_REQFAIL=false
  // to silence once understood.
  if (process.env.FOUNDRY_BRIDGE_LOG_REQFAIL !== "false") {
    page.on("requestfailed", (request) => {
      const f = request.failure();
      log(
        "req-failed",
        `${request.method()} ${request.url()} — ${f ? f.errorText : "unknown"}`,
      );
    });
  }

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
  // Preserve a specific state already recorded by joinWorld (no_world /
  // login_failed); otherwise mark a generic error.
  if (!["no_world", "login_failed"].includes(status.state)) {
    writeStatus({ state: "error", lastError: String(err?.message ?? err) });
  }
  process.exit(1);
});

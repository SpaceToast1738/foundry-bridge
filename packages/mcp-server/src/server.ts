#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { BridgeError, ErrorCode } from "@foundry-bridge/shared";
import {
  parseCredentials,
  type FoundryCredential,
} from "./core/credentials.js";
import { resolveRuntimeConfig } from "./core/config.js";
import { Relay } from "./relay.js";
import { buildToolDefinitions, dispatchTool, type ToolContext } from "./tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadInstructions(): string {
  const candidates = [
    path.join(__dirname, "..", "INSTRUCTIONS.md"),
    path.join(__dirname, "..", "..", "INSTRUCTIONS.md"),
  ];
  for (const file of candidates) {
    try {
      return fs.readFileSync(file, "utf-8");
    } catch {
      // try next candidate
    }
  }
  console.error("[foundry-bridge] Warning: INSTRUCTIONS.md not found");
  return "";
}

function loadCredentials(filePath: string): FoundryCredential[] {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return parseCredentials(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        `[foundry-bridge] No credentials file at ${filePath}; running without (show_credentials will return empty)`,
      );
      return [];
    }
    throw err;
  }
}

function resolveActiveIndex(
  credentials: FoundryCredential[],
  activeId: string | undefined,
): number {
  if (credentials.length === 0) return -1;
  if (!activeId) return 0;
  const idx = credentials.findIndex((c) => c._id === activeId);
  return idx === -1 ? 0 : idx;
}

function formatToolResult(value: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function formatToolError(err: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const payload =
    err instanceof BridgeError
      ? err.toPayload()
      : {
          code: ErrorCode.INTERNAL,
          message: err instanceof Error ? err.message : String(err),
        };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

async function main(): Promise<void> {
  const config = resolveRuntimeConfig(process.env, process.cwd());
  const credentials = loadCredentials(config.credentialsPath);
  const activeIndex = resolveActiveIndex(credentials, config.activeCredentialId);

  const logger = {
    log: (msg: string) => console.error(msg),
    warn: (msg: string) => console.error(msg),
    error: (msg: string) => console.error(msg),
  };

  const relay = new Relay({
    port: config.relayPort,
    host: config.relayHost,
    logger,
  });
  await relay.start();

  const context: ToolContext = {
    relay,
    credentials,
    activeIndex,
  };

  const instructions = loadInstructions();
  const server = new Server(
    { name: "foundry-bridge", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: instructions || undefined,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await dispatchTool(
        name,
        (args as Record<string, unknown> | undefined) ?? undefined,
        context,
      );
      return formatToolResult(result);
    } catch (err) {
      return formatToolError(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[foundry-bridge] MCP server running on stdio");

  const shutdown = async (signal: string) => {
    console.error(`[foundry-bridge] received ${signal}, shutting down`);
    try {
      await relay.stop();
    } catch (err) {
      console.error(`[foundry-bridge] relay.stop error: ${(err as Error).message}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[foundry-bridge] fatal error:", err);
  process.exit(1);
});

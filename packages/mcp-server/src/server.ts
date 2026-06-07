#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

function loadServerVersion(): string {
  for (const file of [
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "..", "..", "package.json"),
  ]) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")).version ?? "unknown";
    } catch {
      // try next candidate
    }
  }
  return "unknown";
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

function createServer(context: ToolContext, instructions: string): Server {
  const server = new Server(
    { name: "foundry-bridge", version: context.serverVersion ?? "0.0.0" },
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

  return server;
}

interface Session {
  server: Server;
  transport: StreamableHTTPServerTransport;
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
    requestTimeoutMs: config.requestTimeoutMs,
    logger,
  });
  await relay.start();

  const context: ToolContext = {
    relay,
    credentials,
    activeIndex,
    serverVersion: loadServerVersion(),
  };

  const instructions = loadInstructions();

  // stdio mode: a desktop client (e.g. Claude Desktop) spawns this process
  // and speaks MCP over stdio. The loopback relay still runs so the in-browser
  // module can connect. All logging goes to stderr, keeping stdout clean for
  // JSON-RPC. Enable with FOUNDRY_BRIDGE_STDIO=1 or the --stdio flag.
  const stdioMode =
    process.env.FOUNDRY_BRIDGE_STDIO === "1" ||
    process.argv.includes("--stdio");
  if (stdioMode) {
    const server = createServer(context, instructions);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[foundry-bridge] MCP server running on stdio");
    const shutdownStdio = async (signal: string) => {
      console.error(`[foundry-bridge] received ${signal}, shutting down`);
      try {
        await server.close();
      } catch {
        /* ignore */
      }
      try {
        await relay.stop();
      } catch (err) {
        console.error(
          `[foundry-bridge] relay.stop error: ${(err as Error).message}`,
        );
      }
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdownStdio("SIGINT"));
    process.on("SIGTERM", () => void shutdownStdio("SIGTERM"));
    return;
  }

  const sessions = new Map<string, Session>();

  async function createSession(): Promise<Session> {
    const server = createServer(context, instructions);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
        console.error(`[foundry-bridge] session ${id} initialized`);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        console.error(`[foundry-bridge] session ${id} closed`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    return { server, transport };
  }

  const app = express();
  app.use(express.json({ limit: "16mb" }));

  const handleMcp = async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    let session: Session | undefined;
    if (sessionId) session = sessions.get(sessionId);
    if (!session) session = await createSession();
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[foundry-bridge] transport error: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  app.all("/mcp", handleMcp);
  // Back-compat: some clients still hit /sse. Treat it the same.
  app.all("/sse", handleMcp);

  // Simple health for load-balancer probes; no auth needed.
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  const gatewayPort = Number(process.env.FOUNDRY_BRIDGE_GATEWAY_PORT ?? 31415);
  const gatewayHost = process.env.FOUNDRY_BRIDGE_GATEWAY_HOST ?? "0.0.0.0";

  const httpServer = app.listen(gatewayPort, gatewayHost, () => {
    console.error(
      `[foundry-bridge] MCP server listening on http://${gatewayHost}:${gatewayPort}/mcp`,
    );
  });

  const shutdown = async (signal: string) => {
    console.error(`[foundry-bridge] received ${signal}, shutting down`);
    httpServer.close();
    for (const session of sessions.values()) {
      try {
        await session.transport.close();
      } catch {
        /* ignore */
      }
    }
    sessions.clear();
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

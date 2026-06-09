#!/usr/bin/env node
import { runStdioServer } from "./server.js";

const command = process.argv[2] ?? "mcp";

if (command !== "mcp") {
  console.error("Peekit is distributed as an MCP server. Start it with `peekit mcp`.");
  process.exit(1);
}

await runStdioServer();

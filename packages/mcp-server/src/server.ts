import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { normalizeUnknownError } from "@peekit/core";
import { toAgentJson } from "@peekit/reporter";
import { PeekitMcpRuntime } from "./runtime.js";
import { PEEKIT_TOOLS } from "./tools.js";

export function createPeekitMcpServer(runtime = new PeekitMcpRuntime()): Server {
  const server = new Server(
    {
      name: "peekit",
      version: "0.1.0-alpha.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: PEEKIT_TOOLS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await runtime.callTool(
        request.params.name,
        request.params.arguments ?? {}
      );
      return {
        content: [
          {
            type: "text",
            text: toAgentJson(result)
          }
        ]
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: toAgentJson({
              error: normalizeUnknownError(error, "mcp")
            })
          }
        ]
      };
    }
  });

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createPeekitMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

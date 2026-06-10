import type {
  EnvironmentInspection,
  McpClientConfigSnippet,
  McpClientConfigSnippetOptions,
  McpServerCommand
} from "./types.js";

const DEFAULT_SERVER_NAME = "peekit";
const DEFAULT_COMMAND = "npx";
const DEFAULT_ARGS = ["-y", "@peekit/cli", "mcp"];

export function suggestMcpClientConfigSnippets(
  environment: EnvironmentInspection,
  options: McpClientConfigSnippetOptions = {}
): McpClientConfigSnippet[] {
  const serverName = normalizeName(options.serverName, DEFAULT_SERVER_NAME);
  const serverCommand: McpServerCommand = {
    command: normalizeName(options.command, DEFAULT_COMMAND),
    args: normalizeArgs(options.args),
    ...(options.env && Object.keys(options.env).length > 0 ? { env: options.env } : {})
  };
  const snippet = {
    mcpServers: {
      [serverName]: serverCommand
    }
  };
  const candidates = matchingClients(environment, options.clientName);

  return candidates.map((client) => ({
    clientName: client.name,
    configPath: client.configPath,
    configExists: client.exists,
    contentRead: false,
    source: client.source,
    writePolicy: "suggestion_only",
    mergeStrategy: "merge_mcpServers_peekit",
    requiresUserAction: true,
    serverName,
    snippet,
    preview: JSON.stringify(snippet, null, 2),
    notes: [
      "Peekit does not read or modify MCP client config contents.",
      `Merge this snippet under the client's existing mcpServers object as ${serverName}.`,
      client.exists
        ? "The config path exists; preserve unrelated existing servers when applying the snippet."
        : "The config path was not found; create it only if this is the client you use."
    ]
  }));
}

function matchingClients(
  environment: EnvironmentInspection,
  clientName?: string
): Array<{
  name: string;
  configPath: string;
  exists: boolean;
  source: "manifest" | "known-path" | "generic";
}> {
  const normalizedClientName = clientName?.trim().toLowerCase();
  const clients = dedupeClients(
    environment.mcpClients.map((client) => ({
      name: client.name,
      configPath: client.configPath,
      exists: client.exists,
      source: client.source
    }))
  ).filter((client) => {
    if (!normalizedClientName) {
      return true;
    }

    return client.name.toLowerCase().includes(normalizedClientName);
  });

  if (clients.length > 0) {
    return clients;
  }

  return [
    {
      name: clientName?.trim() || "Generic MCP client",
      configPath: "<your MCP client config path>",
      exists: false,
      source: "generic"
    }
  ];
}

function dedupeClients<T extends { name: string; configPath: string }>(clients: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const client of clients) {
    const key = `${client.name.toLowerCase()}:${client.configPath.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(client);
  }

  return result;
}

function normalizeName(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function normalizeArgs(args: string[] | undefined): string[] {
  if (!args || args.length === 0) {
    return DEFAULT_ARGS;
  }

  const normalized = args.filter((arg) => arg.length > 0);
  return normalized.length > 0 ? normalized : DEFAULT_ARGS;
}

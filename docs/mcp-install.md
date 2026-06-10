# MCP Install

Use the npm package as the MCP server distribution:

```json
{
  "mcpServers": {
    "peekit": {
      "command": "npx",
      "args": ["-y", "peekit", "mcp"]
    }
  }
}
```

For local development in this repository:

```json
{
  "mcpServers": {
    "peekit": {
      "command": "node",
      "args": ["<repo>/packages/mcp-server/dist/cli.js", "mcp"]
    }
  }
}
```

Build before using the local server:

```sh
pnpm install
pnpm build
```

Peekit writes MCP protocol messages on stdio. Avoid adding normal stdout logging to the server process.

Agents can call `peekit_suggest_mcp_client_config` to generate a config snippet for detected clients. Peekit only returns suggested JSON and path evidence; it does not read existing config contents or write editor configuration files.

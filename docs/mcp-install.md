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
      "args": ["d:/project/peekit/packages/mcp-server/dist/cli.js", "mcp"]
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

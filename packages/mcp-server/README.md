# Peekit

Runtime eyes for AI agents.

This package distributes the Peekit MCP server:

```sh
npx -y peekit mcp
```

Add it to an MCP client:

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

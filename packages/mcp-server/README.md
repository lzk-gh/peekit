# Peekit

Runtime eyes for AI agents.

This package distributes the Peekit MCP server:

```sh
npx -y peekit mcp
```

The `0.1.0-alpha.0` release supports H5 and Weixin Mini Program runtime targets. Other mini program targets are roadmap items and return explicit unsupported evidence.

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

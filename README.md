# Peekit

Runtime eyes for AI agents.

Peekit is an AI-first runtime inspection MCP server. It gives coding agents measured evidence from H5 and planned mini program targets: page state, element text, DOM markup, rects, computed styles, console output, errors, interactions, before/after snapshots, and diagnosis hints.

Peekit is not designed as a human-operated CLI workflow. The npm package is the distribution vehicle for the MCP server.

## Install

Add Peekit to an MCP client:

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

Then ask your coding agent natural-language UI questions:

```txt
Check why this button does not show a loading state after click.
```

```txt
Compare the measured spacing, color, and visibility of this page between H5 and Weixin mini program.
```

```txt
After the fix, verify with Peekit using before/after runtime evidence.
```

## Tools

Peekit exposes these MCP tools:

- `peekit_inspect_environment`
- `peekit_suggest_target_config`
- `peekit_suggest_mcp_client_config`
- `peekit_validate_target`
- `peekit_explain_setup_blocker`
- `peekit_list_targets`
- `peekit_connect_target`
- `peekit_get_current_page`
- `peekit_open_page`
- `peekit_query_element`
- `peekit_query_all`
- `peekit_capture_snapshot`
- `peekit_perform_interaction`
- `peekit_compare_snapshots`
- `peekit_diagnose_issue`
- `peekit_suggest_next_probe`
- `peekit_record_case`
- `peekit_replay_case`
- `peekit_cross_target_compare`

## Current Capability

| Target | Status | Notes |
| --- | --- | --- |
| H5 | Implemented | Playwright-backed page, DOM, text, rect, computed style, console, errors, click, tap, input, scroll, hover |
| Weixin mini program | Implemented | Uses `miniprogram-automator` to connect Weixin Developer Tools and capture route, WXML, text, size, offset, style, console, errors, tap, input, and scroll |
| Alipay mini program | Planned | Public package exists and returns explicit unsupported evidence |
| ByteDance mini program | Planned | Public package exists and returns explicit unsupported evidence |
| QQ mini program | Planned | Public package exists and returns explicit unsupported evidence |

Unsupported fields are reported explicitly so agents can reason from capability evidence instead of guessing.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

Package layout:

```txt
packages/
  core/
  mcp-server/
  adapter-h5/
  adapter-mp-weixin/
  adapter-mp-alipay/
  adapter-mp-bytedance/
  adapter-mp-qq/
  reporter/
docs/
examples/
```

See `docs/ai-usage.md` and `docs/agent-contract.md` for the agent workflow and runtime evidence contract.

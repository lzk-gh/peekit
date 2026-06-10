# Changelog

## 0.1.0-alpha.0

Initial alpha release focused on H5 and Weixin Mini Program runtime inspection for AI agents.

### Supported

- MCP server distribution through the `@peekit/cli` package.
- H5 adapter backed by Playwright.
- Weixin Mini Program adapter backed by Weixin Developer Tools automation.
- Runtime evidence for page state, element text, markup, rects, styles, console output, errors, interactions, snapshots, and before/after comparisons.
- AI setup assistant tools for safe local discovery, target suggestions, validation, setup blockers, and MCP client config snippets.
- Case recording and replay persistence.
- Cross-target H5/Weixin comparison output with agent-readable summaries and next probes.

### Alpha Scope

- H5 and Weixin Mini Program are the only supported runtime targets in this alpha.
- Alipay, ByteDance, and QQ mini program targets remain roadmap items and return explicit unsupported evidence.
- Real Weixin smoke tests are opt-in with `PEEKIT_WEIXIN_SMOKE=1`.

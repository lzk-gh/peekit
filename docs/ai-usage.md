# AI Usage

Peekit is built for agentic coding loops. The developer should be able to describe a UI problem in natural language while the agent performs runtime inspection through MCP tools.

## Standard Agent Loop

```txt
understand user issue
-> inspect environment
-> connect target runtime
-> open page or detect current page
-> query relevant elements
-> capture runtime snapshot
-> perform interaction if needed
-> capture after snapshot
-> compare evidence
-> diagnose likely cause
-> modify code
-> recapture
-> report measured result
```

The agent should not ask the developer to manually run probe commands when the MCP server is available. It should call Peekit tools directly and cite measured evidence in its final answer.

## Useful Tool Sequences

Initial setup:

```txt
peekit_inspect_environment
peekit_suggest_target_config
peekit_suggest_mcp_client_config
peekit_validate_target
peekit_connect_target
```

For the fastest and clearest setup, fill in one of these local manifests:

- User-level machine paths: `~/.peekit/local-setup.json`
- Project-level overrides: `<repo>/.peekit/local-setup.json`

Put stable machine paths such as Weixin DevTools CLI, browser path, and MCP client paths in the user-level file. Put project-specific values such as H5 URL or mini program projectPath in the project file.

Setup tools use safe local discovery. Peekit reads user and project setup manifests first, then falls back only to the project directory, PATH, selected environment variables, and loopback ports. It does not run full disk scans, guess common install paths, read secrets, read editor config contents, scan public networks, or write editor configuration.

For Weixin, agents should not attempt a long connection loop unless `weixin.automation.servicePortEnabled` is `true`. If it is missing or false, report the setup blocker and ask the developer to enable Weixin Developer Tools Settings > Security > Service Port.

For real Weixin Developer Tools troubleshooting, see `docs/weixin-troubleshooting.md`.

`peekit_suggest_mcp_client_config` generates JSON snippets for detected MCP clients. It returns suggested content only; agents must not claim Peekit wrote editor or MCP client configuration.

Element state investigation:

```txt
peekit_query_element
peekit_capture_snapshot
peekit_perform_interaction
peekit_capture_snapshot
peekit_compare_snapshots
peekit_diagnose_issue
```

Fix verification:

```txt
peekit_capture_snapshot before
modify code
peekit_capture_snapshot after
peekit_compare_snapshots
```

## Reporting Rule

The agent's final response should say what changed and include measured runtime facts such as text, className, rect, computed style fields, console errors, and before/after diff summaries.

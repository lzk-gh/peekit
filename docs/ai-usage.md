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
peekit_validate_target
peekit_connect_target
```

For the fastest and clearest setup, copy `.peekit/local-setup.example.json` to `.peekit/local-setup.json` and fill in local editor, browser, Weixin DevTools, and MCP client config paths. The local file is ignored by git.

Setup tools use safe local discovery. Peekit reads the local setup manifest first, then falls back to the project directory, PATH, selected environment variables, common local tool locations, loopback ports, and MCP client config path existence only when needed. It does not run full disk scans, read secrets, read editor config contents, scan public networks, or write editor configuration.

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

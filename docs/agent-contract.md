# Agent Contract

Peekit tools return JSON that is meant to be consumed directly by coding agents.

## RuntimeEvidence

```ts
type RuntimeEvidence = {
  target: string
  capabilityLevel: 0 | 1 | 2 | 3 | 4
  page: {
    url?: string
    route?: string
    title?: string
    query?: Record<string, string>
    viewport?: { width: number; height: number }
    scroll?: { x: number; y: number }
  }
  element?: {
    selector: string
    tag?: string
    text?: string
    className?: string
    attributes?: Record<string, string>
    markup?: string
    rect?: { left: number; top: number; width: number; height: number }
    styles?: Record<string, string>
    state?: Record<string, unknown>
  }
  interaction?: {
    action: "tap" | "click" | "input" | "scroll" | "hover"
    before?: unknown
    after?: unknown
  }
  console: Array<{ type: string; text: string }>
  errors: Array<{ source: string; message: string; stack?: string }>
  unsupported?: Array<{ field: string; reason: string }>
}
```

## Snapshot Contract

`peekit_capture_snapshot` returns `RuntimeSnapshot`, which extends `RuntimeEvidence` with:

```ts
{
  kind: "snapshot"
  snapshotId?: string
  capturedAt: string
  elements: ElementEvidence[]
}
```

Snapshots are stored in memory for the lifetime of one MCP server process. Agents can compare snapshots by id through `peekit_compare_snapshots`.

## Unsupported Contract

Unsupported capability must be explicit:

```json
{
  "unsupported": [
    {
      "field": "element.styles",
      "reason": "mp-weixin adapter does not support queryElement yet"
    }
  ]
}
```

Agents should treat unsupported fields as evidence, not as failure to be hidden.

## Setup Evidence

`peekit_inspect_environment` includes setup fields for AI agents:

```ts
{
  setupManifest: {
    path: string
    exists: boolean
    valid: boolean
    contentRead: boolean
    errors: string[]
  }
  toolchain: {
    system: { platform: string; arch: string; shell?: string }
    node: { version: string; execPath: string }
    packageManagers: Array<{ name: string; selected: boolean; available: boolean; path?: string }>
    playwright: { browsersPath?: string; chromiumAvailable: boolean; searchedPaths: string[] }
    browsers: Array<{ name: string; available: boolean; path?: string; source: string }>
    miniProgramDevTools: Array<{ platform: string; name: string; available: boolean; cliPath?: string; source: string }>
  }
  ports: Array<{ url: string; host: string; port: number; reachable: boolean; status?: number; reason?: string }>
  mcpClients: Array<{ name: string; configPath: string; exists: boolean; contentRead: false; source: string; appPath?: string; appExists?: boolean }>
  editorApps: Array<{ name: string; appPath: string; exists: boolean; source: "manifest" }>
  security: { policy: "safe-local-discovery"; inspected: string[]; skipped: string[] }
  setupBlockers: Array<{ code: string; severity: string; message: string; remediation: string }>
}
```

Agents should read `.peekit/local-setup.json` evidence first when it exists. If the manifest is missing or incomplete, agents should use fallback discovery evidence before asking developers for editor paths, browser paths, or mini program DevTools paths. If a blocker remains, report the `message` and `remediation`.

## MCP Client Config Snippets

`peekit_suggest_mcp_client_config` returns config snippets for detected MCP clients:

```ts
{
  snippets: Array<{
    clientName: string
    configPath: string
    configExists: boolean
    contentRead: false
    writePolicy: "suggestion_only"
    mergeStrategy: "merge_mcpServers_peekit"
    requiresUserAction: true
    snippet: { mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> }
    preview: string
  }>
}
```

Agents may show or merge the returned snippet, but Peekit itself never reads existing config contents and never writes editor or MCP client configuration files.

## Case Persistence

`peekit_record_case` persists cases to `.peekit/cases.json` by default for the current MCP working directory. The server also keeps a hot in-memory cache during the process lifetime.

`peekit_replay_case` can replay a case recorded by an earlier MCP server process when the same case store is available and a compatible target is connected.

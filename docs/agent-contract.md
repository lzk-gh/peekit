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

## Case Persistence

`peekit_record_case` persists cases to `.peekit/cases.json` by default for the current MCP working directory. The server also keeps a hot in-memory cache during the process lifetime.

`peekit_replay_case` can replay a case recorded by an earlier MCP server process when the same case store is available and a compatible target is connected.

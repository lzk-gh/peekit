# Adapter Authoring

Adapters implement the `PeekitAdapter` interface from `@peekit/core`.

```ts
type PeekitAdapter = {
  kind: TargetKind
  id: string
  name: string
  capabilities: AdapterCapabilities
  capabilityLevel: 0 | 1 | 2 | 3 | 4
  connect(config: PeekitTargetConfig): Promise<AdapterSession>
}
```

`AdapterSession` is responsible for measured runtime evidence:

```ts
type AdapterSession = {
  target: ConnectedTarget
  getCurrentPage(): Promise<RuntimeEvidence>
  openPage(url: string): Promise<RuntimeEvidence>
  queryElement(selector: string): Promise<RuntimeEvidence>
  queryAll(selector: string): Promise<RuntimeEvidence[]>
  captureSnapshot(options?: CaptureSnapshotOptions): Promise<RuntimeSnapshot>
  performInteraction(request: InteractionRequest): Promise<RuntimeEvidence>
  close(): Promise<void>
}
```

## Rules

- Return measured runtime data, not source-code guesses.
- Include `unsupported` entries for every missing field that an agent might otherwise assume.
- Keep selectors, text, rects, styles, console output, and errors stable enough for before/after comparison.
- Normalize platform errors into `{ source, message, stack? }`.
- Avoid platform-specific fields unless they live under `state` or `metadata`.

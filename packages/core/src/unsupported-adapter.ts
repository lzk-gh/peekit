import {
  EMPTY_CAPABILITIES,
  capabilityLevelFromCapabilities
} from "./capabilities.js";
import type {
  AdapterCapabilities,
  AdapterSession,
  CaptureSnapshotOptions,
  ConnectedTarget,
  InteractionRequest,
  PeekitAdapter,
  PeekitTargetConfig,
  QueryAllOptions,
  RuntimeEvidence,
  RuntimeSnapshot,
  TargetKind,
  UnsupportedField
} from "./types.js";

export function createUnsupportedAdapter(
  kind: TargetKind,
  name: string,
  capabilities: AdapterCapabilities = EMPTY_CAPABILITIES
): PeekitAdapter {
  return new UnsupportedAdapter(kind, name, capabilities);
}

export function createUnsupportedEvidence(
  target: ConnectedTarget,
  operation: string,
  fields: string[]
): RuntimeEvidence {
  const unsupported: UnsupportedField[] = fields.map((field) => ({
    field,
    reason: `${target.type} adapter does not support ${operation} yet`
  }));

  return {
    target: target.id,
    targetType: target.type,
    capabilityLevel: target.capabilityLevel,
    page: {},
    console: [],
    errors: [],
    unsupported,
    timestamp: new Date().toISOString()
  };
}

class UnsupportedAdapter implements PeekitAdapter {
  readonly id: string;
  readonly capabilityLevel: 0 | 1 | 2 | 3 | 4;

  constructor(
    readonly kind: TargetKind,
    readonly name: string,
    readonly capabilities: AdapterCapabilities
  ) {
    this.id = `peekit-${kind}`;
    this.capabilityLevel = capabilityLevelFromCapabilities(capabilities);
  }

  async connect(config: PeekitTargetConfig): Promise<AdapterSession> {
    const target: ConnectedTarget = {
      id: config.id ?? `${this.kind}:unsupported`,
      type: this.kind,
      name: config.name ?? this.name,
      config,
      connectedAt: new Date().toISOString(),
      capabilityLevel: this.capabilityLevel,
      capabilities: this.capabilities
    };

    return new UnsupportedSession(target);
  }
}

class UnsupportedSession implements AdapterSession {
  constructor(readonly target: ConnectedTarget) {}

  async getCurrentPage(): Promise<RuntimeEvidence> {
    return createUnsupportedEvidence(this.target, "getCurrentPage", ["page"]);
  }

  async openPage(): Promise<RuntimeEvidence> {
    return createUnsupportedEvidence(this.target, "openPage", ["page.url", "page.route"]);
  }

  async queryElement(selector: string): Promise<RuntimeEvidence> {
    const evidence = createUnsupportedEvidence(this.target, "queryElement", [
      "element",
      "element.markup",
      "element.rect",
      "element.styles"
    ]);
    evidence.element = { selector };
    return evidence;
  }

  async queryAll(selector: string, _options?: QueryAllOptions): Promise<RuntimeEvidence[]> {
    return [await this.queryElement(selector)];
  }

  async captureSnapshot(_options?: CaptureSnapshotOptions): Promise<RuntimeSnapshot> {
    return {
      ...createUnsupportedEvidence(this.target, "captureSnapshot", [
        "page",
        "elements",
        "console"
      ]),
      kind: "snapshot",
      capturedAt: new Date().toISOString(),
      elements: []
    };
  }

  async performInteraction(request: InteractionRequest): Promise<RuntimeEvidence> {
    const evidence = createUnsupportedEvidence(this.target, request.action, [
      "interaction",
      "element"
    ]);
    evidence.interaction = {
      action: request.action
    };
    return evidence;
  }

  async close(): Promise<void> {
    return;
  }
}

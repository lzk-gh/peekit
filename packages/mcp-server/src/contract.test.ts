import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  H5_CAPABILITIES,
  capabilityLevelFromCapabilities,
  type AdapterSession,
  type CaptureSnapshotOptions,
  type ConnectedTarget,
  type ElementEvidence,
  type InteractionRequest,
  type PeekitAdapter,
  type PeekitTargetConfig,
  type QueryAllOptions,
  type RuntimeEvidence,
  type RuntimeSnapshot
} from "@peekit/core";
import { PeekitMcpRuntime } from "./runtime.js";
import { PEEKIT_TOOLS } from "./tools.js";

const EXPECTED_TOOL_NAMES = [
  "peekit_inspect_environment",
  "peekit_suggest_target_config",
  "peekit_suggest_mcp_client_config",
  "peekit_validate_target",
  "peekit_explain_setup_blocker",
  "peekit_list_targets",
  "peekit_connect_target",
  "peekit_get_current_page",
  "peekit_open_page",
  "peekit_query_element",
  "peekit_query_all",
  "peekit_capture_snapshot",
  "peekit_perform_interaction",
  "peekit_compare_snapshots",
  "peekit_diagnose_issue",
  "peekit_suggest_next_probe",
  "peekit_record_case",
  "peekit_replay_case",
  "peekit_cross_target_compare"
];

const REQUIRED_FIELDS: Record<string, string[]> = {
  peekit_validate_target: ["target"],
  peekit_connect_target: ["type"],
  peekit_open_page: ["url"],
  peekit_query_element: ["selector"],
  peekit_query_all: ["selector"],
  peekit_perform_interaction: ["action"],
  peekit_record_case: ["name"]
};

describe("MCP tool contract", () => {
  it("keeps tool definitions stable and agent-readable", () => {
    const names = PEEKIT_TOOLS.map((tool) => tool.name);

    expect(names).toEqual(EXPECTED_TOOL_NAMES);
    expect(new Set(names).size).toBe(names.length);
    expect(PEEKIT_TOOLS).toHaveLength(19);

    for (const tool of PEEKIT_TOOLS) {
      expect(tool.description.trim().length).toBeGreaterThan(12);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties ?? {}).toEqual(expect.any(Object));
      expect(tool.inputSchema.required ?? []).toEqual(REQUIRED_FIELDS[tool.name] ?? []);
    }
  });

  it("runs every tool through a stable minimal runtime flow", async () => {
    const runtime = new PeekitMcpRuntime([new FakeH5Adapter()], { persistCases: false });
    const calledTools = new Set<string>();
    const call = async <T>(name: string, args: unknown): Promise<T> => {
      calledTools.add(name);
      return (await runtime.callTool(name, args)) as T;
    };
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const h5ExampleRoot = resolve(repoRoot, "examples/h5-basic");

    const environment = await call<{
      cwd: string;
      packageJson?: { name?: string };
      blockers: string[];
      toolchain: { node: { version: string } };
      ports: unknown[];
      mcpClients: unknown[];
      editorApps: unknown[];
      setupManifest: { path: string; exists: boolean; contentRead: boolean };
      security: { policy: string; skipped: string[] };
      setupBlockers: Array<{ code: string }>;
    }>("peekit_inspect_environment", { cwd: repoRoot });
    expect(environment.cwd).toBe(repoRoot);
    expect(environment.packageJson?.name).toBe("peekit-workspace");
    expect(environment.blockers).toEqual(expect.any(Array));
    expect(environment.toolchain.node.version).toBe(process.version);
    expect(environment.ports).toEqual(expect.any(Array));
    expect(environment.mcpClients).toEqual(expect.any(Array));
    expect(environment.editorApps).toEqual(expect.any(Array));
    expect(environment.setupManifest.path).toContain(".peekit");
    expect(environment.setupManifest.contentRead).toBe(environment.setupManifest.exists);
    expect(environment.security.policy).toBe("safe-local-discovery");
    expect(environment.security.skipped).toEqual(expect.arrayContaining(["full disk scans"]));
    expect(environment.setupBlockers).toEqual(expect.any(Array));

    const suggested = await call<{
      suggestions: Array<{ type: string; url?: string; metadata?: Record<string, unknown> }>;
    }>("peekit_suggest_target_config", {
      cwd: h5ExampleRoot,
      preferredKind: "h5"
    });
    expect(suggested.suggestions[0]).toMatchObject({
      type: "h5",
      url: "http://localhost:5173",
      metadata: {
        source: "package-script"
      }
    });

    const configSnippets = await call<{
      snippets: Array<{
        writePolicy: string;
        contentRead: boolean;
        snippet: { mcpServers: Record<string, { command: string; args: string[] }> };
      }>;
      security: { configContentsRead: boolean; configFilesWritten: boolean };
    }>("peekit_suggest_mcp_client_config", {
      cwd: repoRoot,
      clientName: "Cursor"
    });
    expect(configSnippets.snippets[0]).toMatchObject({
      writePolicy: "suggestion_only",
      contentRead: false,
      snippet: {
        mcpServers: {
          peekit: {
            command: "npx",
            args: ["-y", "peekit", "mcp"]
          }
        }
      }
    });
    expect(configSnippets.security).toMatchObject({
      configContentsRead: false,
      configFilesWritten: false
    });

    const validationTarget = {
      type: "h5",
      connectOverCDP: "ws://localhost:9222/devtools/browser/contract"
    };
    const validation = await call<{ valid: boolean; blockers: string[]; setupBlockers: unknown[] }>(
      "peekit_validate_target",
      { target: validationTarget }
    );
    expect(validation.valid).toBe(true);
    expect(validation.blockers).toEqual([]);
    expect(validation.setupBlockers).toEqual([]);

    const blocker = await call<{ explanation: string }>("peekit_explain_setup_blocker", {
      target: validationTarget
    });
    expect(blocker.explanation).toContain("reachable");

    const emptyTargets = await call<{
      connectedTargets: unknown[];
      capabilityMatrix: Record<string, { status: string }>;
    }>("peekit_list_targets", {});
    expect(emptyTargets.connectedTargets).toEqual([]);
    expect(emptyTargets.capabilityMatrix.h5?.status).toBe("implemented");

    const connected = await call<{
      target: ConnectedTarget;
      evidence: RuntimeEvidence;
    }>("peekit_connect_target", {
      type: "h5",
      id: "h5:contract",
      name: "Contract Target"
    });
    expect(connected.target.id).toBe("h5:contract");
    expectEvidenceShape(connected.evidence, "h5:contract");

    const currentPage = await call<RuntimeEvidence>("peekit_get_current_page", {});
    expectEvidenceShape(currentPage, "h5:contract");

    const opened = await call<RuntimeEvidence>("peekit_open_page", {
      url: "http://localhost:5173/contract?mode=test"
    });
    expect(opened.page.url).toBe("http://localhost:5173/contract?mode=test");

    const elementEvidence = await call<RuntimeEvidence>("peekit_query_element", {
      selector: "#submit"
    });
    expectEvidenceShape(elementEvidence, "h5:contract");
    expect(elementEvidence.element).toMatchObject({
      selector: "#submit",
      tag: "button"
    });

    const allElements = await call<RuntimeEvidence[]>("peekit_query_all", {
      selector: "button",
      maxResults: 2
    });
    expect(allElements).toHaveLength(2);
    expect(allElements[0]?.element?.selector).toBe("button");

    const before = await call<RuntimeSnapshot>("peekit_capture_snapshot", {
      snapshotId: "before",
      selectors: ["#submit"],
      label: "before click"
    });
    expectSnapshotShape(before, "before");

    const interaction = await call<RuntimeEvidence>("peekit_perform_interaction", {
      action: "click",
      selector: "#submit"
    });
    expect(interaction.interaction?.action).toBe("click");
    expect(interaction.element?.text).toBe("Clicked 1");

    const after = await call<RuntimeSnapshot>("peekit_capture_snapshot", {
      snapshotId: "after",
      selectors: ["#submit"],
      label: "after click"
    });
    expectSnapshotShape(after, "after");

    const diff = await call<{ changed: boolean; summary: string[] }>(
      "peekit_compare_snapshots",
      {
        beforeSnapshotId: "before",
        afterSnapshotId: "after"
      }
    );
    expect(diff.changed).toBe(true);
    expect(diff.summary).toEqual(expect.arrayContaining([expect.stringContaining("#submit")]));

    const diagnosis = await call<{
      evidence: string[];
      likelyCauses: string[];
      nextProbes: string[];
    }>("peekit_diagnose_issue", {
      problem: "click did not trigger loading state",
      beforeSnapshotId: "before",
      afterSnapshotId: "after",
      evidence: [interaction]
    });
    expect(diagnosis.evidence.length).toBeGreaterThan(0);
    expect(diagnosis.likelyCauses.length).toBeGreaterThan(0);

    const nextProbe = await call<{ nextProbes: string[] }>("peekit_suggest_next_probe", {
      problem: "click did not trigger loading state",
      beforeSnapshotId: "before",
      afterSnapshotId: "after",
      evidence: [interaction]
    });
    expect(nextProbe.nextProbes.length).toBeGreaterThan(0);

    const recordedCase = await call<{
      id: string;
      name: string;
      snapshotIds: string[];
    }>("peekit_record_case", {
      name: "contract case",
      steps: [{ action: "click", selector: "#submit" }],
      snapshotIds: ["before", "after"],
      notes: "Contract fixture"
    });
    expect(recordedCase.id).toMatch(/^case:/);
    expect(recordedCase.snapshotIds).toEqual(["before", "after"]);

    const replay = await call<{ replayed: boolean; results: RuntimeEvidence[] }>(
      "peekit_replay_case",
      {
        caseId: recordedCase.id
      }
    );
    expect(replay.replayed).toBe(true);
    expect(replay.results[0]?.interaction?.action).toBe("click");

    const crossTarget = await call<{
      leftTarget: string;
      rightTarget: string;
      diff: { changed: boolean };
    }>("peekit_cross_target_compare", {
      leftSnapshotId: "before",
      rightSnapshotId: "after"
    });
    expect(crossTarget.leftTarget).toBe("h5:contract");
    expect(crossTarget.rightTarget).toBe("h5:contract");
    expect(crossTarget.diff.changed).toBe(true);

    expect([...calledTools]).toEqual(EXPECTED_TOOL_NAMES);
    await runtime.close();
  });

  it("keeps missing runtime state failures explicit", async () => {
    const runtime = new PeekitMcpRuntime([new FakeH5Adapter()], { persistCases: false });

    await expect(runtime.callTool("peekit_get_current_page", {})).rejects.toThrow(
      "No active Peekit target"
    );
    await expect(
      runtime.callTool("peekit_compare_snapshots", {
        beforeSnapshotId: "missing-before",
        afterSnapshotId: "missing-after"
      })
    ).rejects.toThrow("Snapshot not found: missing-before");
  });
});

function expectEvidenceShape(evidence: RuntimeEvidence, target: string): void {
  expect(evidence.target).toBe(target);
  expect(evidence.capabilityLevel).toBe(4);
  expect(evidence.page).toEqual(expect.any(Object));
  expect(evidence.console).toEqual(expect.any(Array));
  expect(evidence.errors).toEqual(expect.any(Array));
}

function expectSnapshotShape(snapshot: RuntimeSnapshot, snapshotId: string): void {
  expectEvidenceShape(snapshot, "h5:contract");
  expect(snapshot.kind).toBe("snapshot");
  expect(snapshot.snapshotId).toBe(snapshotId);
  expect(snapshot.elements[0]?.selector).toBe("#submit");
}

class FakeH5Adapter implements PeekitAdapter {
  readonly kind = "h5" as const;
  readonly id = "fake-h5";
  readonly name = "Fake H5 Adapter";
  readonly capabilities = H5_CAPABILITIES;
  readonly capabilityLevel = capabilityLevelFromCapabilities(this.capabilities);

  async connect(config: PeekitTargetConfig): Promise<AdapterSession> {
    const target: ConnectedTarget = {
      id: config.id ?? "h5:contract",
      type: "h5",
      name: config.name ?? "Contract Target",
      config,
      connectedAt: "2026-01-01T00:00:00.000Z",
      capabilityLevel: this.capabilityLevel,
      capabilities: this.capabilities
    };

    return new FakeH5Session(target);
  }
}

class FakeH5Session implements AdapterSession {
  private url = "about:blank";
  private interactionCount = 0;

  constructor(readonly target: ConnectedTarget) {}

  async getCurrentPage(): Promise<RuntimeEvidence> {
    return this.baseEvidence();
  }

  async openPage(url: string): Promise<RuntimeEvidence> {
    this.url = url;
    return this.baseEvidence();
  }

  async queryElement(selector: string): Promise<RuntimeEvidence> {
    return {
      ...(await this.baseEvidence()),
      element: this.element(selector)
    };
  }

  async queryAll(selector: string, options: QueryAllOptions = {}): Promise<RuntimeEvidence[]> {
    const count = Math.min(options.maxResults ?? 2, 2);
    return Promise.all(
      Array.from({ length: count }, async (_, index) => ({
        ...(await this.baseEvidence()),
        element: this.element(selector, index)
      }))
    );
  }

  async captureSnapshot(options: CaptureSnapshotOptions = {}): Promise<RuntimeSnapshot> {
    const selectors = options.selectors?.length ? options.selectors : ["#submit", ".status"];
    const elements = selectors
      .slice(0, options.maxElements ?? selectors.length)
      .map((selector, index) => this.element(selector, index));

    return {
      ...(await this.baseEvidence()),
      kind: "snapshot",
      capturedAt: "2026-01-01T00:00:00.000Z",
      elements,
      ...(options.includeScreenshot
        ? { screenshot: { mimeType: "image/png", data: "contract" } }
        : {})
    };
  }

  async performInteraction(request: InteractionRequest): Promise<RuntimeEvidence> {
    const selector = request.selector ?? "body";
    const before = this.element(selector);
    this.interactionCount += 1;
    const after = this.element(selector);

    return {
      ...(await this.baseEvidence()),
      element: after,
      interaction: {
        action: request.action,
        before,
        after
      }
    };
  }

  async close(): Promise<void> {
    return;
  }

  private async baseEvidence(): Promise<RuntimeEvidence> {
    return {
      target: this.target.id,
      targetType: "h5",
      capabilityLevel: this.target.capabilityLevel,
      page: {
        url: this.url,
        title: "Contract Page",
        viewport: { width: 390, height: 844 },
        scroll: { x: 0, y: 0 }
      },
      console: [{ type: "info", text: "contract fixture ready" }],
      errors: [],
      timestamp: "2026-01-01T00:00:00.000Z"
    };
  }

  private element(selector: string, index = 0): ElementEvidence {
    const isSubmit = selector === "#submit" || selector === "button";
    const text = this.interactionCount > 0 && isSubmit ? `Clicked ${this.interactionCount}` : "Submit";

    return {
      selector,
      tag: isSubmit ? "button" : "div",
      text,
      className: this.interactionCount > 0 && isSubmit ? "button loading" : "button",
      attributes: {
        "data-testid": isSubmit ? "submit-button" : `fixture-${index}`
      },
      markup: `<button data-testid="submit-button">${text}</button>`,
      rect: {
        left: 16,
        top: 24 + index * 48,
        width: 120,
        height: 40
      },
      styles: {
        display: "block",
        color: "rgb(255, 255, 255)",
        "background-color": this.interactionCount > 0 && isSubmit ? "rgb(92, 102, 122)" : "rgb(18, 100, 216)"
      },
      state: {
        visible: true
      }
    };
  }
}

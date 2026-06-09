import { randomUUID } from "node:crypto";
import { createH5Adapter } from "@peekit/adapter-h5";
import { createAlipayMiniProgramAdapter } from "@peekit/adapter-mp-alipay";
import { createByteDanceMiniProgramAdapter } from "@peekit/adapter-mp-bytedance";
import { createQQMiniProgramAdapter } from "@peekit/adapter-mp-qq";
import { createWeixinMiniProgramAdapter } from "@peekit/adapter-mp-weixin";
import {
  CaptureSnapshotOptionsSchema,
  InteractionRequestSchema,
  PeekitTargetConfigSchema,
  RuntimeEvidenceSchema,
  RuntimeSnapshotSchema,
  diagnoseIssue,
  diffSnapshots,
  explainSetupBlocker,
  getCapabilityMatrix,
  inspectProjectEnvironment,
  suggestMcpClientConfigSnippets,
  suggestNextProbe,
  suggestTargetConfigs,
  validateTargetConfig,
  type AdapterSession,
  type InteractionRequest,
  type PeekitAdapter,
  type RuntimeEvidence,
  type RuntimeSnapshot,
  type SnapshotDiff,
  type TargetKind,
  type TargetValidationResult
} from "@peekit/core";
import { JsonCaseStore, type RecordedCase } from "./case-store.js";

export type PeekitMcpRuntimeOptions = {
  caseStorePath?: string;
  persistCases?: boolean;
};

export class PeekitMcpRuntime {
  private readonly adapters = new Map<TargetKind, PeekitAdapter>();
  private readonly sessions = new Map<string, AdapterSession>();
  private readonly snapshots = new Map<string, RuntimeSnapshot>();
  private readonly cases = new Map<string, RecordedCase>();
  private readonly caseStore?: JsonCaseStore;
  private casesLoaded = false;
  private activeTargetId?: string;

  constructor(adapters: PeekitAdapter[] = defaultAdapters(), options: PeekitMcpRuntimeOptions = {}) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.kind, adapter);
    }
    this.caseStore =
      options.persistCases === false
        ? undefined
        : new JsonCaseStore(options.caseStorePath);
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    switch (name) {
      case "peekit_inspect_environment":
        return this.inspectEnvironment(args);
      case "peekit_suggest_target_config":
        return this.suggestTargetConfig(args);
      case "peekit_suggest_mcp_client_config":
        return this.suggestMcpClientConfig(args);
      case "peekit_validate_target":
        return this.validateTarget(args);
      case "peekit_explain_setup_blocker":
        return this.explainSetupBlocker(args);
      case "peekit_list_targets":
        return this.listTargets();
      case "peekit_connect_target":
        return this.connectTarget(args);
      case "peekit_get_current_page":
        return this.getSessionFromArgs(args).getCurrentPage();
      case "peekit_open_page":
        return this.openPage(args);
      case "peekit_query_element":
        return this.queryElement(args);
      case "peekit_query_all":
        return this.queryAll(args);
      case "peekit_capture_snapshot":
        return this.captureSnapshot(args);
      case "peekit_perform_interaction":
        return this.performInteraction(args);
      case "peekit_compare_snapshots":
        return this.compareSnapshots(args);
      case "peekit_diagnose_issue":
        return this.diagnose(args);
      case "peekit_suggest_next_probe":
        return this.suggestNextProbe(args);
      case "peekit_record_case":
        return this.recordCase(args);
      case "peekit_replay_case":
        return this.replayCase(args);
      case "peekit_cross_target_compare":
        return this.crossTargetCompare(args);
      default:
        throw new Error(`Unknown Peekit tool: ${name}`);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
    this.activeTargetId = undefined;
  }

  private async inspectEnvironment(args: unknown) {
    const record = asRecord(args);
    return inspectProjectEnvironment(typeof record.cwd === "string" ? record.cwd : process.cwd());
  }

  private async suggestTargetConfig(args: unknown) {
    const record = asRecord(args);
    const environment = await inspectProjectEnvironment(
      typeof record.cwd === "string" ? record.cwd : process.cwd()
    );
    const preferredKind = typeof record.preferredKind === "string" ? record.preferredKind : undefined;

    return {
      environment,
      suggestions: suggestTargetConfigs(environment, preferredKind as TargetKind | undefined)
    };
  }

  private async suggestMcpClientConfig(args: unknown) {
    const record = asRecord(args);
    const environment = await inspectProjectEnvironment(
      typeof record.cwd === "string" ? record.cwd : process.cwd()
    );
    const snippets = suggestMcpClientConfigSnippets(environment, {
      ...(typeof record.clientName === "string" ? { clientName: record.clientName } : {}),
      ...(typeof record.serverName === "string" ? { serverName: record.serverName } : {}),
      ...(typeof record.command === "string" ? { command: record.command } : {}),
      ...(Array.isArray(record.args)
        ? { args: record.args.filter((arg): arg is string => typeof arg === "string") }
        : {}),
      ...(isStringRecord(record.env) ? { env: record.env } : {})
    });

    return {
      cwd: environment.cwd,
      setupManifest: environment.setupManifest,
      mcpClients: environment.mcpClients,
      editorApps: environment.editorApps,
      snippets,
      security: {
        writePolicy: "suggestion_only",
        configContentsRead: false,
        configFilesWritten: false
      }
    };
  }

  private async validateTarget(args: unknown): Promise<TargetValidationResult> {
    const record = asRecord(args);
    const targetInput = isRecord(record.target) ? record.target : record;
    const target = PeekitTargetConfigSchema.parse(targetInput);
    return validateTargetConfig(target);
  }

  private async explainSetupBlocker(args: unknown) {
    const record = asRecord(args);
    const validation = isRecord(record.validation)
      ? (record.validation as TargetValidationResult)
      : await this.validateTarget(record);

    return {
      validation,
      explanation: explainSetupBlocker(validation)
    };
  }

  private listTargets() {
    return {
      activeTargetId: this.activeTargetId,
      connectedTargets: [...this.sessions.values()].map((session) => session.target),
      capabilityMatrix: getCapabilityMatrix()
    };
  }

  private async connectTarget(args: unknown) {
    const config = PeekitTargetConfigSchema.parse(args);
    const adapter = this.adapters.get(config.type);

    if (!adapter) {
      throw new Error(`No adapter registered for target type: ${config.type}`);
    }

    const session = await adapter.connect(config);
    this.sessions.set(session.target.id, session);
    this.activeTargetId = session.target.id;

    return {
      target: session.target,
      evidence: await session.getCurrentPage()
    };
  }

  private async openPage(args: unknown) {
    const record = asRecord(args);
    const url = requireString(record, "url");
    return this.getSessionFromArgs(record).openPage(url);
  }

  private async queryElement(args: unknown) {
    const record = asRecord(args);
    const selector = requireString(record, "selector");
    return this.getSessionFromArgs(record).queryElement(selector);
  }

  private async queryAll(args: unknown) {
    const record = asRecord(args);
    const selector = requireString(record, "selector");
    const maxResults = typeof record.maxResults === "number" ? record.maxResults : undefined;
    return this.getSessionFromArgs(record).queryAll(selector, {
      ...(maxResults ? { maxResults } : {})
    });
  }

  private async captureSnapshot(args: unknown) {
    const record = asRecord(args);
    const options = CaptureSnapshotOptionsSchema.parse(record);
    const snapshot = await this.getSessionFromArgs(record).captureSnapshot(options);
    const snapshotId =
      typeof record.snapshotId === "string" && record.snapshotId.length > 0
        ? record.snapshotId
        : `snap:${randomUUID()}`;
    const metadata = {
      ...(snapshot.metadata ?? {}),
      ...(typeof record.label === "string" ? { label: record.label } : {})
    };
    const stored: RuntimeSnapshot = {
      ...snapshot,
      snapshotId,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {})
    };

    this.snapshots.set(snapshotId, stored);
    return stored;
  }

  private async performInteraction(args: unknown) {
    const record = asRecord(args);
    const request = InteractionRequestSchema.parse(record);
    return this.getSessionFromArgs(record).performInteraction(request);
  }

  private compareSnapshots(args: unknown): SnapshotDiff {
    const before = this.resolveSnapshot(args, "before");
    const after = this.resolveSnapshot(args, "after");
    return diffSnapshots(before, after);
  }

  private diagnose(args: unknown) {
    const record = asRecord(args);
    const before = this.tryResolveSnapshot(record, "before");
    const after = this.tryResolveSnapshot(record, "after");
    const evidence = parseEvidenceList(record.evidence);
    const diff = isRecord(record.diff) ? (record.diff as SnapshotDiff) : undefined;

    return diagnoseIssue({
      ...(typeof record.problem === "string" ? { problem: record.problem } : {}),
      ...(evidence ? { evidence } : {}),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      ...(diff ? { diff } : {})
    });
  }

  private suggestNextProbe(args: unknown) {
    const record = asRecord(args);
    const before = this.tryResolveSnapshot(record, "before");
    const after = this.tryResolveSnapshot(record, "after");
    const evidence = parseEvidenceList(record.evidence);
    const diff = isRecord(record.diff) ? (record.diff as SnapshotDiff) : undefined;

    return {
      nextProbes: suggestNextProbe({
        ...(typeof record.problem === "string" ? { problem: record.problem } : {}),
        ...(evidence ? { evidence } : {}),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ...(diff ? { diff } : {})
      })
    };
  }

  private async recordCase(args: unknown): Promise<RecordedCase> {
    const record = asRecord(args);
    const name = requireString(record, "name");
    await this.loadCases();
    const steps = Array.isArray(record.steps)
      ? record.steps.map((step) => InteractionRequestSchema.parse(step))
      : [];
    const snapshotIds = Array.isArray(record.snapshotIds)
      ? record.snapshotIds.filter((snapshotId): snapshotId is string => typeof snapshotId === "string")
      : [];
    const targetId =
      typeof record.targetId === "string" ? record.targetId : this.activeTargetId;
    const stored: RecordedCase = {
      id: `case:${randomUUID()}`,
      name,
      createdAt: new Date().toISOString(),
      steps,
      snapshotIds,
      ...(targetId ? { targetId } : {}),
      ...(typeof record.notes === "string" ? { notes: record.notes } : {})
    };

    this.cases.set(stored.id, stored);
    await this.saveCases();
    return stored;
  }

  private async replayCase(args: unknown) {
    const record = asRecord(args);
    const stored = await this.findCase(record);

    if (!stored) {
      throw new Error("Recorded case not found");
    }

    if (stored.steps.length === 0) {
      return {
        case: stored,
        replayed: false,
        reason: "case has no recorded interaction steps",
        results: []
      };
    }

    const session = this.getSession(
      typeof record.targetId === "string" ? record.targetId : stored.targetId
    );
    const results = [];

    for (const step of stored.steps) {
      results.push(await session.performInteraction(step));
    }

    return {
      case: stored,
      replayed: true,
      results
    };
  }

  private crossTargetCompare(args: unknown) {
    const left = this.resolveSnapshot(args, "left");
    const right = this.resolveSnapshot(args, "right");
    return {
      leftTarget: left.target,
      rightTarget: right.target,
      diff: diffSnapshots(left, right)
    };
  }

  private resolveSnapshot(args: unknown, key: "before" | "after" | "left" | "right"): RuntimeSnapshot {
    const snapshot = this.tryResolveSnapshot(asRecord(args), key);
    if (!snapshot) {
      throw new Error(`Missing snapshot for ${key}`);
    }
    return snapshot;
  }

  private tryResolveSnapshot(
    record: Record<string, unknown>,
    key: "before" | "after" | "left" | "right"
  ): RuntimeSnapshot | undefined {
    const idKey = `${key}SnapshotId`;
    const fallbackIdKey = `${key}Id`;
    const id = typeof record[idKey] === "string" ? record[idKey] : record[fallbackIdKey];

    if (typeof id === "string") {
      const snapshot = this.snapshots.get(id);
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${id}`);
      }
      return snapshot;
    }

    if (isRecord(record[key])) {
      return RuntimeSnapshotSchema.parse(record[key]);
    }

    return undefined;
  }

  private getSessionFromArgs(args: unknown): AdapterSession {
    const record = asRecord(args);
    return this.getSession(typeof record.targetId === "string" ? record.targetId : undefined);
  }

  private getSession(targetId?: string): AdapterSession {
    const requestedTargetId = targetId ?? this.activeTargetId;

    if (requestedTargetId) {
      const session = this.sessions.get(requestedTargetId);
      if (!session) {
        throw new Error(`Target is not connected: ${requestedTargetId}`);
      }
      return session;
    }

    if (this.sessions.size === 1) {
      const session = [...this.sessions.values()][0];
      if (session) {
        return session;
      }
    }

    throw new Error("No active Peekit target. Call peekit_connect_target first.");
  }

  private async findCase(record: Record<string, unknown>): Promise<RecordedCase | undefined> {
    await this.loadCases();

    if (typeof record.caseId === "string") {
      return this.cases.get(record.caseId);
    }

    if (typeof record.name === "string") {
      return [...this.cases.values()].find((item) => item.name === record.name);
    }

    return undefined;
  }

  private async loadCases(): Promise<void> {
    if (this.casesLoaded || !this.caseStore) {
      return;
    }

    for (const recordedCase of await this.caseStore.load()) {
      this.cases.set(recordedCase.id, recordedCase);
    }
    this.casesLoaded = true;
  }

  private async saveCases(): Promise<void> {
    if (!this.caseStore) {
      return;
    }

    await this.caseStore.save([...this.cases.values()]);
  }
}

function defaultAdapters(): PeekitAdapter[] {
  return [
    createH5Adapter(),
    createWeixinMiniProgramAdapter(),
    createAlipayMiniProgramAdapter(),
    createByteDanceMiniProgramAdapter(),
    createQQMiniProgramAdapter()
  ];
}

function parseEvidenceList(value: unknown): RuntimeEvidence[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => RuntimeEvidenceSchema.parse(item));
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item): item is string => typeof item === "string")
  );
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

export type TargetKind =
  | "h5"
  | "mp-weixin"
  | "mp-alipay"
  | "mp-bytedance"
  | "mp-qq";

export type CapabilityLevel = 0 | 1 | 2 | 3 | 4;

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export type AdapterCapabilities = {
  launch: boolean;
  queryElement: boolean;
  getMarkup: boolean;
  getText: boolean;
  getRect: boolean;
  getStyle: boolean;
  tap: boolean;
  input: boolean;
  scroll: boolean;
  console: boolean;
};

export type Viewport = {
  width: number;
  height: number;
};

export type PageEvidence = {
  url?: string;
  route?: string;
  title?: string;
  query?: Record<string, string>;
  viewport?: Viewport;
  scroll?: { x: number; y: number };
};

export type ElementEvidence = {
  selector: string;
  tag?: string;
  text?: string;
  className?: string;
  attributes?: Record<string, string>;
  markup?: string;
  rect?: { left: number; top: number; width: number; height: number };
  styles?: Record<string, string>;
  state?: Record<string, unknown>;
};

export type ConsoleEntry = {
  type: string;
  text: string;
  location?: string;
};

export type RuntimeError = {
  source: string;
  message: string;
  stack?: string;
};

export type UnsupportedField = {
  field: string;
  reason: string;
};

export type InteractionAction = "tap" | "click" | "input" | "scroll" | "hover";

export type InteractionEvidence = {
  action: InteractionAction;
  before?: unknown;
  after?: unknown;
};

export type RuntimeEvidence = {
  target: string;
  targetType?: TargetKind;
  capabilityLevel: CapabilityLevel;
  page: PageEvidence;
  element?: ElementEvidence;
  interaction?: InteractionEvidence;
  console: ConsoleEntry[];
  errors: RuntimeError[];
  unsupported?: UnsupportedField[];
  timestamp?: string;
};

export type RuntimeSnapshot = RuntimeEvidence & {
  kind: "snapshot";
  snapshotId?: string;
  capturedAt: string;
  elements: ElementEvidence[];
  screenshot?: {
    mimeType: string;
    data?: string;
    path?: string;
  };
  metadata?: Record<string, unknown>;
};

export type PeekitTargetConfig = {
  id?: string;
  name?: string;
  type: TargetKind;
  url?: string;
  route?: string;
  rootDir?: string;
  projectPath?: string;
  cliPath?: string;
  wsEndpoint?: string;
  port?: number;
  account?: string;
  ticket?: string;
  trustProject?: boolean;
  browser?: "chromium" | "firefox" | "webkit";
  headless?: boolean;
  viewport?: Viewport;
  connectOverCDP?: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
};

export type ConnectedTarget = Required<Pick<PeekitTargetConfig, "id" | "type">> & {
  name: string;
  config: PeekitTargetConfig;
  connectedAt: string;
  capabilityLevel: CapabilityLevel;
  capabilities: AdapterCapabilities;
};

export type CaptureSnapshotOptions = {
  selectors?: string[];
  maxElements?: number;
  includeScreenshot?: boolean;
};

export type QueryAllOptions = {
  maxResults?: number;
};

export type InteractionRequest = {
  action: InteractionAction;
  selector?: string;
  text?: string;
  value?: string;
  scroll?: {
    x?: number;
    y?: number;
  };
  waitAfterMs?: number;
};

export interface AdapterSession {
  readonly target: ConnectedTarget;
  getCurrentPage(): Promise<RuntimeEvidence>;
  openPage(url: string): Promise<RuntimeEvidence>;
  queryElement(selector: string): Promise<RuntimeEvidence>;
  queryAll(selector: string, options?: QueryAllOptions): Promise<RuntimeEvidence[]>;
  captureSnapshot(options?: CaptureSnapshotOptions): Promise<RuntimeSnapshot>;
  performInteraction(request: InteractionRequest): Promise<RuntimeEvidence>;
  close(): Promise<void>;
}

export interface PeekitAdapter {
  readonly kind: TargetKind;
  readonly id: string;
  readonly name: string;
  readonly capabilities: AdapterCapabilities;
  readonly capabilityLevel: CapabilityLevel;
  connect(config: PeekitTargetConfig): Promise<AdapterSession>;
}

export type FieldChange = {
  field: string;
  before?: unknown;
  after?: unknown;
};

export type ElementChange = {
  selector: string;
  status: "added" | "removed" | "changed" | "unchanged";
  changes: FieldChange[];
};

export type SnapshotDiff = {
  beforeId?: string;
  afterId?: string;
  changed: boolean;
  pageChanges: FieldChange[];
  elementChanges: ElementChange[];
  consoleChanges: {
    added: ConsoleEntry[];
    removed: ConsoleEntry[];
  };
  errorChanges: {
    added: RuntimeError[];
    removed: RuntimeError[];
  };
  summary: string[];
};

export type Diagnosis = {
  problem?: string;
  evidence: string[];
  likelyCauses: string[];
  nextProbes: string[];
};

export type SetupBlockerCode =
  | "missing_package_json"
  | "missing_dev_server"
  | "missing_tool"
  | "port_unreachable"
  | "permission_required"
  | "unsupported_platform"
  | "invalid_target";

export type SetupBlocker = {
  code: SetupBlockerCode;
  severity: "info" | "warning" | "error";
  message: string;
  remediation: string;
  target?: TargetKind;
  evidence?: Record<string, unknown>;
};

export type PortInspection = {
  url: string;
  host: string;
  port: number;
  protocol: "http:" | "https:";
  reachable: boolean;
  status?: number;
  reason?: string;
  source: string;
};

export type ToolchainInspection = {
  system: {
    platform: NodeJS.Platform;
    arch: string;
    shell?: string;
  };
  node: {
    version: string;
    execPath: string;
  };
  packageManagers: Array<{
    name: "pnpm" | "npm" | "yarn" | "bun";
    selected: boolean;
    available: boolean;
    path?: string;
  }>;
  playwright: {
    browsersPath?: string;
    chromiumAvailable: boolean;
    searchedPaths: string[];
  };
  browsers: Array<{
    name: "chromium" | "chrome" | "edge";
    available: boolean;
    path?: string;
    source: "env" | "path" | "common-path" | "playwright-cache";
  }>;
  miniProgramDevTools: Array<{
    platform: TargetKind;
    name: string;
    available: boolean;
    cliPath?: string;
    source: "env" | "path" | "common-path";
  }>;
};

export type McpClientInspection = {
  name: string;
  configPath: string;
  exists: boolean;
  contentRead: false;
};

export type SecurityInspection = {
  policy: "safe-local-discovery";
  inspected: string[];
  skipped: string[];
};

export type EnvironmentInspection = {
  cwd: string;
  packageManager?: PackageManager;
  packageJson?: {
    name?: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  frameworks: string[];
  devServerHints: Array<{
    script: string;
    command: string;
    likelyUrl?: string;
  }>;
  miniProgramHints: Array<{
    platform: TargetKind;
    file: string;
  }>;
  blockers: string[];
  setupBlockers: SetupBlocker[];
  toolchain: ToolchainInspection;
  ports: PortInspection[];
  mcpClients: McpClientInspection[];
  security: SecurityInspection;
};

export type TargetValidationResult = {
  valid: boolean;
  target: PeekitTargetConfig;
  checkedAt: string;
  reachable?: boolean;
  status?: number;
  blockers: string[];
  setupBlockers?: SetupBlocker[];
};

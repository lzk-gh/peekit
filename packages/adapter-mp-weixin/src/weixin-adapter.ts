import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import automator from "miniprogram-automator";
import {
  WEIXIN_MINI_PROGRAM_CAPABILITIES,
  capabilityLevelFromCapabilities,
  createUnsupportedEvidence,
  normalizeUnknownError,
  type AdapterSession,
  type CaptureSnapshotOptions,
  type ConnectedTarget,
  type ConsoleEntry,
  type ElementEvidence,
  type InteractionRequest,
  type PeekitAdapter,
  type PeekitTargetConfig,
  type QueryAllOptions,
  type RuntimeError,
  type RuntimeEvidence,
  type RuntimeSnapshot
} from "@peekit/core";

const STYLE_FIELDS = [
  "display",
  "visibility",
  "opacity",
  "position",
  "z-index",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "line-height"
];

const DEFAULT_DISCOVERY_SELECTOR = "view,button,input,textarea,text,scroll-view,image";
const DEFAULT_WEIXIN_AUTOMATION_PORT = 9420;

type AutomatorLike = {
  connect(options: { wsEndpoint: string }): Promise<MiniProgramLike>;
  launch(options: AutomatorLaunchOptions): Promise<MiniProgramLike>;
};

type AutomatorLaunchOptions = {
  cliPath?: string;
  args?: string[];
  timeout?: number;
  port?: number;
  account?: string;
  ticket?: string;
  projectPath: string;
  trustProject?: boolean;
  cwd?: string;
};

type MiniProgramLike = {
  on(event: "console" | "exception", listener: (payload: unknown) => void): MiniProgramLike;
  currentPage(): Promise<PageLike | undefined>;
  reLaunch(url: string): Promise<PageLike | undefined>;
  navigateTo(url: string): Promise<PageLike | undefined>;
  pageScrollTo(scrollTop: number): Promise<void>;
  systemInfo(): Promise<Record<string, unknown>>;
  screenshot(options?: { path?: string }): Promise<string | void>;
  close(): Promise<void>;
  disconnect(): void;
};

type PageLike = {
  path: string;
  query: Record<string, unknown>;
  $(selector: string): Promise<ElementLike | null>;
  $$(selector: string): Promise<ElementLike[]>;
  size(): Promise<{ width: string; height: string }>;
  scrollTop(): Promise<string | string[]>;
  waitFor(condition: string | number | Function): Promise<void>;
};

type ElementLike = {
  tagName: string;
  $?(selector: string): Promise<ElementLike | null>;
  $$?(selector: string): Promise<ElementLike[]>;
  size(): Promise<{ width: string; height: string }>;
  offset(): Promise<Record<string, unknown>>;
  text(): Promise<string>;
  attribute(name: string): Promise<string>;
  value(): Promise<unknown>;
  property(name: string): Promise<unknown>;
  wxml(): Promise<string>;
  outerWxml(): Promise<string>;
  style(name: string): Promise<string>;
  tap(): Promise<void>;
  input?: (value: string) => Promise<void>;
  scrollTo?: (x: number, y: number) => Promise<void>;
};

export type WeixinMiniProgramAdapterOptions = {
  automator?: unknown;
};

export function createWeixinMiniProgramAdapter(
  options: WeixinMiniProgramAdapterOptions = {}
): WeixinMiniProgramAdapter {
  return new WeixinMiniProgramAdapter(options);
}

export class WeixinMiniProgramAdapter implements PeekitAdapter {
  readonly kind = "mp-weixin" as const;
  readonly id = "peekit-mp-weixin";
  readonly name = "Weixin Mini Program Adapter";
  readonly capabilities = WEIXIN_MINI_PROGRAM_CAPABILITIES;
  readonly capabilityLevel = capabilityLevelFromCapabilities(this.capabilities);
  private readonly api: AutomatorLike;
  private readonly hasInjectedAutomator: boolean;

  constructor(options: WeixinMiniProgramAdapterOptions = {}) {
    this.hasInjectedAutomator = options.automator !== undefined;
    this.api = (options.automator ?? automator) as AutomatorLike;
  }

  async connect(config: PeekitTargetConfig): Promise<AdapterSession> {
    const timeout = config.timeoutMs ?? 30_000;

    if (!config.wsEndpoint && !config.projectPath && !config.rootDir) {
      throw new Error("mp-weixin target needs projectPath, rootDir, or wsEndpoint");
    }

    const miniProgram = config.wsEndpoint
      ? await this.api.connect({ wsEndpoint: config.wsEndpoint })
      : this.shouldLaunchWithWindowsCli(config)
        ? await this.launchWithWindowsCli(config, timeout)
        : await this.api.launch(buildLaunchOptions(config, timeout));

    const target: ConnectedTarget = {
      id: config.id ?? `mp-weixin:${config.projectPath ?? config.rootDir ?? config.wsEndpoint ?? randomUUID()}`,
      type: "mp-weixin",
      name: config.name ?? "Weixin Mini Program",
      config,
      connectedAt: new Date().toISOString(),
      capabilityLevel: this.capabilityLevel,
      capabilities: this.capabilities
    };

    const session = new WeixinMiniProgramSession(target, miniProgram);
    const initialRoute = config.route ?? config.url;
    if (initialRoute) {
      await session.openPage(initialRoute);
    }
    return session;
  }

  private shouldLaunchWithWindowsCli(config: PeekitTargetConfig): boolean {
    return (
      !this.hasInjectedAutomator &&
      process.platform === "win32" &&
      config.cliPath !== undefined &&
      isWindowsCommandScript(config.cliPath)
    );
  }

  private async launchWithWindowsCli(
    config: PeekitTargetConfig,
    timeout: number
  ): Promise<MiniProgramLike> {
    const cliPath = config.cliPath;
    if (!cliPath) {
      throw new Error("mp-weixin Windows CLI launch needs cliPath");
    }

    const projectPath = config.projectPath ?? config.rootDir ?? "";
    const port = config.port ?? DEFAULT_WEIXIN_AUTOMATION_PORT;
    const command = resolveWindowsCliCommand(cliPath);
    const args = [
      ...command.argsPrefix,
      "auto",
      "--project",
      projectPath,
      "--auto-port",
      String(port),
      ...(config.ticket ? ["--ticket", config.ticket] : []),
      ...(config.trustProject ?? true ? ["--trust-project"] : [])
    ];

    const child = spawn(command.executable, args, {
      cwd: config.rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let launchError: Error | undefined;
    let launchExitCode: number | null | undefined;
    let launchOutput = "";
    child.on("error", (error) => {
      launchError = error;
    });
    child.on("exit", (code) => {
      launchExitCode = code;
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      launchOutput = compactLaunchOutput(`${launchOutput}${chunk.toString("utf8")}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      launchOutput = compactLaunchOutput(`${launchOutput}${chunk.toString("utf8")}`);
    });

    const miniProgram = await this.waitForConnection(`ws://127.0.0.1:${port}`, timeout, () => {
      if (launchError) {
        return launchError;
      }
      if (launchExitCode && launchExitCode !== 0) {
        return new Error(
          `Weixin CLI exited with code ${launchExitCode}${launchOutput ? `: ${launchOutput}` : ""}`
        );
      }
      return undefined;
    });
    await sleep(5_000);
    return miniProgram;
  }

  private async waitForConnection(
    wsEndpoint: string,
    timeout: number,
    readLaunchError: () => Error | undefined
  ): Promise<MiniProgramLike> {
    const deadline = Date.now() + timeout;
    let lastError: unknown;

    while (Date.now() < deadline) {
      const launchError = readLaunchError();
      if (launchError) {
        throw new Error(`Failed to launch Weixin Developer Tools: ${launchError.message}`);
      }

      try {
        return await withTimeout(this.api.connect({ wsEndpoint }), 3_000, `connect ${wsEndpoint}`);
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `Failed connecting to ${wsEndpoint}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}

function buildLaunchOptions(config: PeekitTargetConfig, timeout: number): AutomatorLaunchOptions {
  const cliLaunch = buildCliLaunch(config.cliPath);

  return {
    projectPath: config.projectPath ?? config.rootDir ?? "",
    ...cliLaunch,
    ...(config.port ? { port: config.port } : {}),
    ...(config.account ? { account: config.account } : {}),
    ...(config.ticket ? { ticket: config.ticket } : {}),
    ...(config.rootDir ? { cwd: config.rootDir } : {}),
    trustProject: config.trustProject ?? true,
    timeout
  };
}

function buildCliLaunch(cliPath: string | undefined): Pick<AutomatorLaunchOptions, "cliPath" | "args"> {
  if (!cliPath) {
    return {};
  }

  if (process.platform === "win32" && isWindowsCommandScript(cliPath)) {
    return {
      cliPath: "cmd",
      args: ["/d", "/s", "/c", "call", cliPath]
    };
  }

  return { cliPath };
}

function isWindowsCommandScript(cliPath: string): boolean {
  return /\.(bat|cmd)$/i.test(cliPath);
}

function resolveWindowsCliCommand(cliPath: string): { executable: string; argsPrefix: string[] } {
  const cliDir = dirname(cliPath);
  const nodePath = join(cliDir, "node.exe");
  const cliScriptPath = join(cliDir, "cli.js");

  if (existsSync(nodePath) && existsSync(cliScriptPath)) {
    return {
      executable: nodePath,
      argsPrefix: [cliScriptPath]
    };
  }

  return {
    executable: "cmd",
    argsPrefix: ["/d", "/s", "/c", "call", cliPath]
  };
}

function compactLaunchOutput(output: string): string {
  return output.replace(/\s+/g, " ").trim().slice(-1000);
}

class WeixinMiniProgramSession implements AdapterSession {
  private readonly consoleBuffer: ConsoleEntry[] = [];
  private readonly errorBuffer: RuntimeError[] = [];

  constructor(readonly target: ConnectedTarget, private readonly miniProgram: MiniProgramLike) {
    this.attachListeners();
  }

  async getCurrentPage(): Promise<RuntimeEvidence> {
    return this.baseEvidence();
  }

  async openPage(url: string): Promise<RuntimeEvidence> {
    await this.miniProgram.reLaunch(url);
    return this.baseEvidence();
  }

  async queryElement(selector: string): Promise<RuntimeEvidence> {
    const base = await this.baseEvidence();
    const page = await this.currentPage();

    if (!page) {
      return {
        ...base,
        element: { selector },
        errors: [...base.errors, { source: "page", message: "No current mini program page" }]
      };
    }

    const element = await page.$(selector);
    if (!element) {
      return {
        ...base,
        element: { selector },
        errors: [...base.errors, { source: "wxml", message: `Element not found: ${selector}` }]
      };
    }

    return {
      ...base,
      element: await this.captureElement(element, selector)
    };
  }

  async queryAll(selector: string, options: QueryAllOptions = {}): Promise<RuntimeEvidence[]> {
    const page = await this.currentPage();
    if (!page) {
      return [await this.queryElement(selector)];
    }

    const maxResults = options.maxResults ?? 20;
    const elements = (await page.$$(selector)).slice(0, maxResults);

    if (elements.length === 0) {
      return [await this.queryElement(selector)];
    }

    const results: RuntimeEvidence[] = [];
    for (let index = 0; index < elements.length; index += 1) {
      const base = await this.baseEvidence();
      const element = elements[index];
      if (!element) {
        continue;
      }
      results.push({
        ...base,
        element: await this.captureElement(element, selector, index)
      });
    }
    return results;
  }

  async captureSnapshot(options: CaptureSnapshotOptions = {}): Promise<RuntimeSnapshot> {
    const base = await this.baseEvidence();
    const maxElements = options.maxElements ?? 50;
    const elements = options.selectors?.length
      ? await this.captureSelected(options.selectors, maxElements)
      : await this.captureSelected([DEFAULT_DISCOVERY_SELECTOR], maxElements);
    const data = options.includeScreenshot ? await this.miniProgram.screenshot() : undefined;

    return {
      ...base,
      kind: "snapshot",
      capturedAt: new Date().toISOString(),
      elements,
      ...(typeof data === "string" ? { screenshot: { mimeType: "image/png", data } } : {})
    };
  }

  async performInteraction(request: InteractionRequest): Promise<RuntimeEvidence> {
    if (request.action === "hover") {
      const evidence = createUnsupportedEvidence(this.target, "hover", ["interaction.hover"]);
      evidence.interaction = { action: request.action };
      return evidence;
    }

    const before = request.selector
      ? (await this.queryElement(request.selector)).element
      : await this.getCurrentPage();
    await this.perform(request);

    if (request.waitAfterMs !== undefined) {
      await this.wait(request.waitAfterMs);
    } else {
      await this.wait(200);
    }

    const after = request.selector
      ? (await this.queryElement(request.selector)).element
      : await this.getCurrentPage();
    const base = await this.baseEvidence();
    const element = request.selector && isElementEvidence(after) ? after : undefined;

    return {
      ...base,
      ...(element ? { element } : {}),
      interaction: {
        action: request.action,
        before,
        after
      }
    };
  }

  async close(): Promise<void> {
    await sleep(250);
    await this.miniProgram.close().catch(() => {
      this.miniProgram.disconnect();
    });
  }

  private async perform(request: InteractionRequest): Promise<void> {
    if (request.action === "scroll") {
      const y = request.scroll?.y ?? 400;
      const x = request.scroll?.x ?? 0;

      if (!request.selector) {
        await this.miniProgram.pageScrollTo(y);
        return;
      }

      const element = await this.requireElement(request.selector);
      if (!element.scrollTo) {
        throw new Error(`Element does not support scrollTo: ${request.selector}`);
      }
      await element.scrollTo(x, y);
      return;
    }

    if (!request.selector) {
      throw new Error(`${request.action} requires selector`);
    }

    const element = await this.requireElement(request.selector);

    if (request.action === "tap" || request.action === "click") {
      await element.tap();
      return;
    }

    if (request.action === "input") {
      if (!element.input) {
        throw new Error(`Element does not support input: ${request.selector}`);
      }
      await element.input(request.value ?? request.text ?? "");
    }
  }

  private async requireElement(selector: string): Promise<ElementLike> {
    const page = await this.currentPage();
    if (!page) {
      throw new Error("No current mini program page");
    }

    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    return element;
  }

  private async captureSelected(
    selectors: string[],
    maxElements: number
  ): Promise<ElementEvidence[]> {
    const elements: ElementEvidence[] = [];

    for (const selector of selectors) {
      if (elements.length >= maxElements) {
        break;
      }
      const matches = await this.queryAll(selector, { maxResults: maxElements - elements.length });
      for (const match of matches) {
        if (match.element) {
          elements.push(match.element);
        }
      }
    }

    return elements;
  }

  private async captureElement(
    element: ElementLike,
    selector: string,
    index?: number
  ): Promise<ElementEvidence> {
    const [text, className, id, markup, size, offset, value] = await Promise.all([
      safe(() => element.text()),
      safe(() => element.attribute("class")),
      safe(() => element.attribute("id")),
      safe(() => element.outerWxml()),
      safe(() => element.size()),
      safe(() => element.offset()),
      safe(() => element.value())
    ]);
    const styles = await this.captureStyles(element);
    const width = parseNumber(size?.width);
    const height = parseNumber(size?.height);
    const left = parseNumber(offset?.left);
    const top = parseNumber(offset?.top);
    const resolvedSelector =
      selector === DEFAULT_DISCOVERY_SELECTOR
        ? `${element.tagName.toLowerCase()}:nth(${index ?? 0})`
        : selector;
    const attributes: Record<string, string> = {};

    if (className) {
      attributes.class = className;
    }
    if (id) {
      attributes.id = id;
    }

    return {
      selector: resolvedSelector,
      tag: element.tagName.toLowerCase(),
      ...(text !== undefined ? { text: compact(text, 500) } : {}),
      ...(className !== undefined ? { className } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      ...(markup !== undefined ? { markup: compact(markup, 2000) } : {}),
      ...(width !== undefined || height !== undefined || left !== undefined || top !== undefined
        ? {
            rect: {
              left: left ?? 0,
              top: top ?? 0,
              width: width ?? 0,
              height: height ?? 0
            }
          }
        : {}),
      ...(Object.keys(styles).length > 0 ? { styles } : {}),
      state: {
        ...(value !== undefined ? { value } : {})
      }
    };
  }

  private async captureStyles(element: ElementLike): Promise<Record<string, string>> {
    const styles: Record<string, string> = {};

    for (const field of STYLE_FIELDS) {
      const value = await safe(() => element.style(field));
      if (value !== undefined) {
        styles[field] = value;
      }
    }

    return styles;
  }

  private async baseEvidence(): Promise<RuntimeEvidence> {
    return {
      target: this.target.id,
      targetType: this.target.type,
      capabilityLevel: this.target.capabilityLevel,
      page: await this.capturePage(),
      console: [...this.consoleBuffer],
      errors: [...this.errorBuffer],
      timestamp: new Date().toISOString()
    };
  }

  private async capturePage(): Promise<RuntimeEvidence["page"]> {
    const page = await this.currentPage();
    if (!page) {
      return {};
    }

    const [size, scrollTop, systemInfo] = await Promise.all([
      safe(() => page.size()),
      safe(() => page.scrollTop()),
      safe(() => this.miniProgram.systemInfo())
    ]);
    const width = parseNumber(size?.width ?? systemInfo?.windowWidth);
    const height = parseNumber(size?.height ?? systemInfo?.windowHeight);
    const y = Array.isArray(scrollTop) ? parseNumber(scrollTop[0]) : parseNumber(scrollTop);

    return {
      route: page.path,
      query: stringifyQuery(page.query),
      ...(width !== undefined && height !== undefined ? { viewport: { width, height } } : {}),
      ...(y !== undefined ? { scroll: { x: 0, y } } : {})
    };
  }

  private async currentPage(): Promise<PageLike | undefined> {
    try {
      return await this.miniProgram.currentPage();
    } catch (error) {
      this.pushError(normalizeUnknownError(error, "mp-weixin"));
      return undefined;
    }
  }

  private async wait(ms: number): Promise<void> {
    const page = await this.currentPage();
    if (page) {
      await page.waitFor(ms);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private attachListeners(): void {
    const consoleListener = (payload: unknown) => {
      this.pushConsole(toConsoleEntry(payload));
    };

    if (!this.attachConsoleListener(consoleListener)) {
      this.miniProgram.on("console", consoleListener);
    }

    this.miniProgram.on("exception", (payload) => {
      this.pushError(toRuntimeError(payload));
    });
  }

  private attachConsoleListener(listener: (payload: unknown) => void): boolean {
    const miniProgram = this.miniProgram as MiniProgramLike & {
      send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    };

    if (typeof miniProgram.send !== "function") {
      return false;
    }

    EventEmitter.prototype.on.call(miniProgram, "console", listener);
    miniProgram.send("App.enableLog").catch((error: unknown) => {
      this.pushError(normalizeUnknownError(error, "mp-weixin"));
    });
    return true;
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleBuffer.push(entry);
    if (this.consoleBuffer.length > 200) {
      this.consoleBuffer.shift();
    }
  }

  private pushError(error: RuntimeError): void {
    this.errorBuffer.push(error);
    if (this.errorBuffer.length > 100) {
      this.errorBuffer.shift();
    }
  }
}

async function safe<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function stringifyQuery(query: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
  );
}

function toConsoleEntry(payload: unknown): ConsoleEntry {
  const record = isRecord(payload) ? payload : {};
  const type =
    typeof record.level === "string"
      ? record.level
      : typeof record.type === "string"
        ? record.type
        : "log";
  const text =
    typeof record.message === "string"
      ? record.message
      : typeof record.text === "string"
        ? record.text
        : JSON.stringify(payload);

  return { type, text };
}

function toRuntimeError(payload: unknown): RuntimeError {
  const record = isRecord(payload) ? payload : {};
  const message =
    typeof record.message === "string"
      ? record.message
      : typeof record.text === "string"
        ? record.text
        : JSON.stringify(payload);

  return {
    source: "mp-weixin",
    message,
    ...(typeof record.stack === "string" ? { stack: record.stack } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isElementEvidence(value: unknown): value is ElementEvidence {
  return isRecord(value) && typeof value.selector === "string";
}

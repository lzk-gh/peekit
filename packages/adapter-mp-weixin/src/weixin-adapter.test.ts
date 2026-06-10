import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdapterSession, PeekitTargetConfig, RuntimeEvidence } from "@peekit/core";
import { createWeixinMiniProgramAdapter } from "./index.js";

describe("WeixinMiniProgramAdapter fixture", () => {
  let session: AdapterSession | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it("launches with explicit config and captures current page evidence", async () => {
    const automator = new FakeAutomator();
    session = await createFixtureSession(automator, {
      route: "/pages/index/index?scene=fixture",
      trustProject: false,
      timeoutMs: 1234
    });

    expect(automator.launches).toHaveLength(1);
    expect(automator.launches[0]).toMatchObject({
      projectPath: "/workspace/miniapp",
      cliPath: "/tools/weixin-devtools/cli",
      port: 9420,
      trustProject: false,
      timeout: 1234
    });

    const page = await session.getCurrentPage();

    expectEvidenceShape(page);
    expect(page.page).toMatchObject({
      route: "pages/index/index",
      query: { scene: "fixture" },
      viewport: { width: 390, height: 844 },
      scroll: { x: 0, y: 0 }
    });

    const opened = await session.openPage("/pages/detail/index?from=test");
    expect(opened.page.route).toBe("pages/detail/index");
    expect(opened.page.query).toEqual({ from: "test" });
  });

  it("queries one element with WXML, layout, style, and state evidence", async () => {
    const automator = new FakeAutomator();
    session = await createFixtureSession(automator);

    const button = await session.queryElement("#submit");

    expectEvidenceShape(button);
    expect(button.element).toMatchObject({
      selector: "#submit",
      tag: "button",
      text: "Submit",
      className: "primary",
      attributes: {
        id: "submit",
        class: "primary"
      },
      rect: {
        left: 24,
        top: 48,
        width: 112,
        height: 40
      },
      styles: {
        display: "block",
        color: "#ffffff",
        "background-color": "#1264d8"
      },
      state: {}
    });
    expect(button.element?.markup).toContain('data-testid="submit-button"');

    const input = await session.queryElement("#name");
    expect(input.element).toMatchObject({
      selector: "#name",
      tag: "input",
      state: { value: "" }
    });
  });

  it("queries multiple elements and respects maxResults", async () => {
    const automator = new FakeAutomator();
    session = await createFixtureSession(automator);

    const items = await session.queryAll(".item", { maxResults: 2 });

    expect(items).toHaveLength(2);
    expect(items[0]?.element).toMatchObject({
      selector: ".item",
      text: "Alpha"
    });
    expect(items[1]?.element).toMatchObject({
      selector: ".item",
      text: "Beta"
    });
  });

  it("captures selected snapshots with optional screenshots", async () => {
    const automator = new FakeAutomator();
    session = await createFixtureSession(automator);

    const snapshot = await session.captureSnapshot({
      selectors: ["#submit", ".item"],
      maxElements: 3,
      includeScreenshot: true
    });

    expectEvidenceShape(snapshot);
    expect(snapshot.kind).toBe("snapshot");
    expect(snapshot.elements).toHaveLength(3);
    expect(snapshot.elements[0]?.selector).toBe("#submit");
    expect(snapshot.elements[1]?.text).toBe("Alpha");
    expect(snapshot.elements[2]?.text).toBe("Beta");
    expect(snapshot.screenshot).toEqual({
      mimeType: "image/png",
      data: "fake-weixin-screenshot"
    });
  });

  it("performs tap, input, and scroll interactions with before and after evidence", async () => {
    const automator = new FakeAutomator();
    session = await createFixtureSession(automator);

    const tap = await session.performInteraction({
      action: "tap",
      selector: "#submit",
      waitAfterMs: 0
    });

    expectEvidenceShape(tap);
    expect(tap.interaction?.action).toBe("tap");
    expect(tap.interaction?.before).toMatchObject({
      text: "Submit",
      className: "primary"
    });
    expect(tap.interaction?.after).toMatchObject({
      text: "Loading",
      className: "primary loading"
    });
    expect(tap.element?.text).toBe("Loading");
    expect(tap.console).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "info",
          text: "submit clicked"
        })
      ])
    );

    const status = await session.queryElement("#status");
    expect(status.element?.text).toBe("Request in progress");

    const input = await session.performInteraction({
      action: "input",
      selector: "#name",
      value: "Ada Lovelace",
      waitAfterMs: 0
    });
    expect(input.element?.state?.value).toBe("Ada Lovelace");

    await session.performInteraction({
      action: "scroll",
      scroll: { y: 640 },
      waitAfterMs: 0
    });

    const page = await session.getCurrentPage();
    expect(page.page.scroll).toEqual({ x: 0, y: 640 });
  });

  it("returns explicit unsupported and error evidence", async () => {
    const automator = new FakeAutomator();
    session = await createFixtureSession(automator);

    const hover = await session.performInteraction({ action: "hover" });
    expect(hover.unsupported).toEqual([
      expect.objectContaining({
        field: "interaction.hover"
      })
    ]);

    const missing = await session.queryElement("#missing");
    expect(missing.element?.selector).toBe("#missing");
    expect(missing.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "wxml",
          message: "Element not found: #missing"
        })
      ])
    );

    automator.program.emitException({ message: "fixture exception", stack: "stack trace" });
    const page = await session.getCurrentPage();
    expect(page.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "mp-weixin",
          message: "fixture exception",
          stack: "stack trace"
        })
      ])
    );
  });
});

describe("WeixinMiniProgramAdapter real smoke", () => {
  const runSmoke = process.env.PEEKIT_WEIXIN_SMOKE === "1" ? it : it.skip;

  runSmoke("connects only when local setup explicitly allows automation", async () => {
    const config = await loadSmokeConfig();
    const smokeSession = await createWeixinMiniProgramAdapter().connect(config);

    try {
      const page = await smokeSession.getCurrentPage();
      expect(page.target).toBe("mp-weixin:smoke");
      expect(page.targetType).toBe("mp-weixin");
      expect(page.page).toEqual(expect.any(Object));
      expect(page.console).toEqual(expect.any(Array));
      expect(page.errors).toEqual(expect.any(Array));
    } finally {
      await smokeSession.close();
    }
  });
});

async function createFixtureSession(
  automator: FakeAutomator,
  overrides: Partial<PeekitTargetConfig> = {}
): Promise<AdapterSession> {
  return createWeixinMiniProgramAdapter({ automator }).connect({
    type: "mp-weixin",
    id: "mp-weixin:fixture",
    name: "Weixin Fixture",
    projectPath: "/workspace/miniapp",
    cliPath: "/tools/weixin-devtools/cli",
    port: 9420,
    timeoutMs: 10_000,
    ...overrides
  });
}

function expectEvidenceShape(evidence: RuntimeEvidence): void {
  expect(evidence.target).toBe("mp-weixin:fixture");
  expect(evidence.targetType).toBe("mp-weixin");
  expect(evidence.capabilityLevel).toBe(4);
  expect(evidence.page).toEqual(expect.any(Object));
  expect(evidence.console).toEqual(expect.any(Array));
  expect(evidence.errors).toEqual(expect.any(Array));
}

async function loadSmokeConfig(): Promise<PeekitTargetConfig> {
  const manifestPath = resolve(process.cwd(), ".peekit", "local-setup.json");

  if (!existsSync(manifestPath)) {
    throw new Error(
      "PEEKIT_WEIXIN_SMOKE is enabled, but .peekit/local-setup.json was not found. " +
        "Create the local-only setup manifest before running the Weixin smoke test."
    );
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isRecord(manifest) || !isRecord(manifest.weixin)) {
    throw new Error("PEEKIT_WEIXIN_SMOKE needs weixin settings in .peekit/local-setup.json.");
  }

  const automation = isRecord(manifest.weixin.automation) ? manifest.weixin.automation : {};
  if (automation.servicePortEnabled !== true) {
    throw new Error(
      "PEEKIT_WEIXIN_SMOKE requires weixin.automation.servicePortEnabled to be true. " +
        "Enable Weixin Developer Tools Settings > Security > Service Port first."
    );
  }

  if (typeof manifest.weixin.cliPath !== "string" || manifest.weixin.cliPath.length === 0) {
    throw new Error("PEEKIT_WEIXIN_SMOKE requires weixin.cliPath in .peekit/local-setup.json.");
  }

  if (typeof manifest.weixin.projectPath !== "string" || manifest.weixin.projectPath.length === 0) {
    throw new Error(
      "PEEKIT_WEIXIN_SMOKE requires weixin.projectPath in .peekit/local-setup.json."
    );
  }

  return {
    type: "mp-weixin",
    id: "mp-weixin:smoke",
    cliPath: manifest.weixin.cliPath,
    projectPath: manifest.weixin.projectPath,
    ...(typeof automation.port === "number" ? { port: automation.port } : {}),
    automation: { servicePortEnabled: true },
    timeoutMs: 15_000
  };
}

class FakeAutomator {
  readonly program = new FakeMiniProgram();
  readonly launches: Array<Record<string, unknown>> = [];
  readonly connections: Array<Record<string, unknown>> = [];

  async launch(options: Record<string, unknown>): Promise<FakeMiniProgram> {
    this.launches.push(options);
    return this.program;
  }

  async connect(options: Record<string, unknown>): Promise<FakeMiniProgram> {
    this.connections.push(options);
    return this.program;
  }
}

class FakeMiniProgram {
  readonly page = new FakePage(this);
  private readonly consoleListeners: Array<(payload: unknown) => void> = [];
  private readonly exceptionListeners: Array<(payload: unknown) => void> = [];
  private closed = false;

  on(event: "console" | "exception", listener: (payload: unknown) => void): FakeMiniProgram {
    if (event === "console") {
      this.consoleListeners.push(listener);
    } else {
      this.exceptionListeners.push(listener);
    }
    return this;
  }

  async currentPage(): Promise<FakePage | undefined> {
    return this.closed ? undefined : this.page;
  }

  async reLaunch(url: string): Promise<FakePage> {
    this.page.setRoute(url);
    return this.page;
  }

  async navigateTo(url: string): Promise<FakePage> {
    this.page.setRoute(url);
    return this.page;
  }

  async pageScrollTo(scrollTop: number): Promise<void> {
    this.page.scrollY = scrollTop;
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return { windowWidth: 390, windowHeight: 844 };
  }

  async screenshot(): Promise<string> {
    return "fake-weixin-screenshot";
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  disconnect(): void {
    this.closed = true;
  }

  emitConsole(payload: unknown): void {
    for (const listener of this.consoleListeners) {
      listener(payload);
    }
  }

  emitException(payload: unknown): void {
    for (const listener of this.exceptionListeners) {
      listener(payload);
    }
  }
}

class FakePage {
  path = "pages/index/index";
  query: Record<string, unknown> = {};
  scrollY = 0;
  readonly elements: FakeElement[];

  constructor(private readonly program: FakeMiniProgram) {
    this.elements = [
      new FakeElement(this, {
        tagName: "BUTTON",
        id: "submit",
        className: "primary",
        testId: "submit-button",
        text: "Submit",
        rect: { left: 24, top: 48, width: 112, height: 40 },
        styles: {
          display: "block",
          color: "#ffffff",
          "background-color": "#1264d8"
        },
        onTap: (element) => {
          element.textContent = "Loading";
          element.className = "primary loading";
          this.findById("status").textContent = "Request in progress";
          this.program.emitConsole({ level: "info", message: "submit clicked" });
        }
      }),
      new FakeElement(this, {
        tagName: "VIEW",
        id: "status",
        className: "status",
        testId: "status",
        text: "Idle",
        rect: { left: 24, top: 104, width: 200, height: 24 },
        styles: {
          display: "block",
          color: "#334155"
        }
      }),
      new FakeElement(this, {
        tagName: "INPUT",
        id: "name",
        className: "field",
        testId: "name-input",
        value: "",
        rect: { left: 24, top: 144, width: 240, height: 36 },
        styles: {
          display: "block",
          color: "#0f172a",
          "background-color": "#ffffff"
        }
      }),
      new FakeElement(this, {
        tagName: "VIEW",
        className: "item",
        text: "Alpha",
        rect: { left: 24, top: 200, width: 160, height: 24 }
      }),
      new FakeElement(this, {
        tagName: "VIEW",
        className: "item",
        text: "Beta",
        rect: { left: 24, top: 232, width: 160, height: 24 }
      }),
      new FakeElement(this, {
        tagName: "VIEW",
        className: "item",
        text: "Gamma",
        rect: { left: 24, top: 264, width: 160, height: 24 }
      })
    ];
  }

  async $(selector: string): Promise<FakeElement | null> {
    return this.elements.find((element) => element.matches(selector)) ?? null;
  }

  async $$(selector: string): Promise<FakeElement[]> {
    return this.elements.filter((element) => element.matches(selector));
  }

  async size(): Promise<{ width: string; height: string }> {
    return { width: "390", height: "844" };
  }

  async scrollTop(): Promise<string> {
    return String(this.scrollY);
  }

  async waitFor(_condition: string | number | Function): Promise<void> {
    return undefined;
  }

  setRoute(route: string): void {
    const normalized = route.replace(/^\//, "");
    const [path = "", search = ""] = normalized.split("?");
    this.path = path;
    this.query = Object.fromEntries(new URLSearchParams(search));
  }

  private findById(id: string): FakeElement {
    const element = this.elements.find((candidate) => candidate.id === id);
    if (!element) {
      throw new Error(`Fixture element not found: ${id}`);
    }
    return element;
  }
}

type FakeElementInit = {
  tagName: string;
  id?: string;
  className?: string;
  testId?: string;
  text?: string;
  value?: string;
  rect: { left: number; top: number; width: number; height: number };
  styles?: Record<string, string>;
  onTap?: (element: FakeElement) => void;
};

class FakeElement {
  textContent: string;
  className: string;
  valueText: string | undefined;

  constructor(
    private readonly page: FakePage,
    private readonly init: FakeElementInit
  ) {
    this.textContent = init.text ?? "";
    this.className = init.className ?? "";
    this.valueText = init.value;
  }

  get tagName(): string {
    return this.init.tagName;
  }

  get id(): string | undefined {
    return this.init.id;
  }

  async size(): Promise<{ width: string; height: string }> {
    return {
      width: String(this.init.rect.width),
      height: String(this.init.rect.height)
    };
  }

  async offset(): Promise<Record<string, unknown>> {
    return {
      left: this.init.rect.left,
      top: this.init.rect.top
    };
  }

  async text(): Promise<string> {
    return this.textContent;
  }

  async attribute(name: string): Promise<string> {
    if (name === "id") {
      return this.init.id ?? "";
    }
    if (name === "class") {
      return this.className;
    }
    if (name === "data-testid") {
      return this.init.testId ?? "";
    }
    return "";
  }

  async value(): Promise<unknown> {
    return this.valueText;
  }

  async property(_name: string): Promise<unknown> {
    return undefined;
  }

  async wxml(): Promise<string> {
    return this.outerWxml();
  }

  async outerWxml(): Promise<string> {
    const attributes = [
      this.init.id ? `id="${this.init.id}"` : undefined,
      this.className ? `class="${this.className}"` : undefined,
      this.init.testId ? `data-testid="${this.init.testId}"` : undefined,
      this.valueText !== undefined ? `value="${this.valueText}"` : undefined
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ");
    const tag = this.init.tagName.toLowerCase();

    return `<${tag}${attributes ? ` ${attributes}` : ""}>${this.textContent}</${tag}>`;
  }

  async style(name: string): Promise<string> {
    return this.init.styles?.[name] ?? "";
  }

  async tap(): Promise<void> {
    this.init.onTap?.(this);
  }

  async input(value: string): Promise<void> {
    this.valueText = value;
  }

  async scrollTo(_x: number, y: number): Promise<void> {
    this.page.scrollY = y;
  }

  matches(selector: string): boolean {
    if (selector.includes(",")) {
      return selector.split(",").some((part) => this.matches(part.trim()));
    }

    if (selector.startsWith("#")) {
      return this.init.id === selector.slice(1);
    }

    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }

    const testId = selector.match(/^\[data-testid(?:=['"]?([^'"\]]+)['"]?)?\]$/);
    if (testId) {
      return testId[1] ? this.init.testId === testId[1] : Boolean(this.init.testId);
    }

    return this.init.tagName.toLowerCase() === selector.toLowerCase();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

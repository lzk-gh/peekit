import { randomUUID } from "node:crypto";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type ConsoleMessage,
  type ElementHandle,
  type Page
} from "playwright";
import {
  H5_CAPABILITIES,
  capabilityLevelFromCapabilities,
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
  "box-sizing",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "line-height",
  "border",
  "pointer-events",
  "overflow",
  "transform"
];

const DEFAULT_DISCOVERY_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role]",
  "[data-testid]",
  "[aria-label]",
  "[class]"
].join(",");

type CapturedElement = {
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

export function createH5Adapter(): H5Adapter {
  return new H5Adapter();
}

export class H5Adapter implements PeekitAdapter {
  readonly kind = "h5" as const;
  readonly id = "peekit-h5";
  readonly name = "H5 Playwright Adapter";
  readonly capabilities = H5_CAPABILITIES;
  readonly capabilityLevel = capabilityLevelFromCapabilities(this.capabilities);

  async connect(config: PeekitTargetConfig): Promise<AdapterSession> {
    const timeoutMs = config.timeoutMs ?? 10_000;
    const browserName = config.browser ?? "chromium";
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;

    if (config.connectOverCDP) {
      if (browserName !== "chromium") {
        throw new Error("connectOverCDP is only supported by Chromium");
      }
      browser = await chromium.connectOverCDP(config.connectOverCDP, { timeout: timeoutMs });
      context = browser.contexts()[0] ?? (await browser.newContext(contextOptions(config)));
      page = context.pages()[0] ?? (await context.newPage());
    } else {
      browser = await browserType(browserName).launch({
        headless: config.headless ?? true,
        timeout: timeoutMs
      });
      context = await browser.newContext(contextOptions(config));
      page = await context.newPage();
    }

    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    const target: ConnectedTarget = {
      id: config.id ?? `h5:${config.url ?? randomUUID()}`,
      type: "h5",
      name: config.name ?? "H5",
      config,
      connectedAt: new Date().toISOString(),
      capabilityLevel: this.capabilityLevel,
      capabilities: this.capabilities
    };

    const session = new H5Session(target, browser, context, page, timeoutMs);

    if (config.url) {
      await session.openPage(config.url);
    }

    return session;
  }
}

class H5Session implements AdapterSession {
  private readonly consoleBuffer: ConsoleEntry[] = [];
  private readonly errorBuffer: RuntimeError[] = [];

  constructor(
    readonly target: ConnectedTarget,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly timeoutMs: number
  ) {
    this.attachListeners(page);
  }

  async getCurrentPage(): Promise<RuntimeEvidence> {
    return this.baseEvidence();
  }

  async openPage(url: string): Promise<RuntimeEvidence> {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: this.timeoutMs
    });
    return this.baseEvidence();
  }

  async queryElement(selector: string): Promise<RuntimeEvidence> {
    const base = await this.baseEvidence();
    const handle = await this.page.$(selector);

    if (!handle) {
      return {
        ...base,
        element: { selector },
        errors: [
          ...base.errors,
          {
            source: "dom",
            message: `Element not found: ${selector}`
          }
        ]
      };
    }

    try {
      return {
        ...base,
        element: await this.captureElementFromHandle(handle, selector)
      };
    } finally {
      await handle.dispose();
    }
  }

  async queryAll(selector: string, options: QueryAllOptions = {}): Promise<RuntimeEvidence[]> {
    const maxResults = options.maxResults ?? 20;
    const handles = (await this.page.$$(selector)).slice(0, maxResults);
    const results: RuntimeEvidence[] = [];

    for (let index = 0; index < handles.length; index += 1) {
      const handle = handles[index];
      if (!handle) {
        continue;
      }
      try {
        const base = await this.baseEvidence();
        results.push({
          ...base,
          element: await this.captureElementFromHandle(handle, selector, index)
        });
      } finally {
        await handle.dispose();
      }
    }

    if (results.length === 0) {
      results.push(await this.queryElement(selector));
    }

    return results;
  }

  async captureSnapshot(options: CaptureSnapshotOptions = {}): Promise<RuntimeSnapshot> {
    const base = await this.baseEvidence();
    const maxElements = options.maxElements ?? 50;
    const elements = options.selectors?.length
      ? await this.captureSelectedElements(options.selectors, maxElements)
      : await this.discoverElements(maxElements);
    const screenshot = options.includeScreenshot
      ? {
          mimeType: "image/png",
          data: (await this.page.screenshot({ type: "png" })).toString("base64")
        }
      : undefined;

    return {
      ...base,
      kind: "snapshot",
      capturedAt: new Date().toISOString(),
      elements,
      ...(screenshot ? { screenshot } : {})
    };
  }

  async performInteraction(request: InteractionRequest): Promise<RuntimeEvidence> {
    const before = request.selector
      ? (await this.queryElement(request.selector)).element
      : await this.getCurrentPage();

    await this.perform(request);

    if (request.waitAfterMs !== undefined) {
      await this.page.waitForTimeout(request.waitAfterMs);
    } else {
      await this.page.waitForTimeout(100);
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
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }

  private async perform(request: InteractionRequest): Promise<void> {
    switch (request.action) {
      case "click":
      case "tap":
        if (!request.selector) {
          throw new Error(`${request.action} requires selector`);
        }
        await this.page.click(request.selector);
        return;
      case "hover":
        if (!request.selector) {
          throw new Error("hover requires selector");
        }
        await this.page.hover(request.selector);
        return;
      case "input":
        if (!request.selector) {
          throw new Error("input requires selector");
        }
        await this.page.fill(request.selector, request.value ?? request.text ?? "");
        return;
      case "scroll":
        await this.performScroll(request);
        return;
      default:
        assertNever(request.action);
    }
  }

  private async performScroll(request: InteractionRequest): Promise<void> {
    const x = request.scroll?.x ?? 0;
    const y = request.scroll?.y ?? 400;

    if (request.selector) {
      const handle = await this.page.$(request.selector);
      if (!handle) {
        throw new Error(`Element not found: ${request.selector}`);
      }
      try {
        await handle.evaluate(
          (node, delta) => {
            node.scrollBy(delta.x, delta.y);
          },
          { x, y }
        );
      } finally {
        await handle.dispose();
      }
      return;
    }

    await this.page.evaluate(
      (delta) => {
        window.scrollBy(delta.x, delta.y);
      },
      { x, y }
    );
  }

  private async captureSelectedElements(
    selectors: string[],
    maxElements: number
  ): Promise<ElementEvidence[]> {
    const elements: ElementEvidence[] = [];

    for (const selector of selectors) {
      if (elements.length >= maxElements) {
        break;
      }
      const remaining = maxElements - elements.length;
      const matches = await this.queryAll(selector, { maxResults: remaining });
      for (const match of matches) {
        if (match.element) {
          elements.push(match.element);
        }
      }
    }

    return elements;
  }

  private async discoverElements(maxElements: number): Promise<ElementEvidence[]> {
    const handles = (await this.page.$$(DEFAULT_DISCOVERY_SELECTOR)).slice(0, maxElements);
    const elements: ElementEvidence[] = [];

    for (let index = 0; index < handles.length; index += 1) {
      const handle = handles[index];
      if (!handle) {
        continue;
      }
      try {
        elements.push(await this.captureElementFromHandle(handle, undefined, index));
      } finally {
        await handle.dispose();
      }
    }

    return elements;
  }

  private async captureElementFromHandle(
    handle: ElementHandle,
    selector?: string,
    index?: number
  ): Promise<ElementEvidence> {
    const captured = await handle.evaluate(
      (node, args): CapturedElement => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        const computed = window.getComputedStyle(element);
        const attributes: Record<string, string> = {};
        const styles: Record<string, string> = {};
        const className =
          typeof element.className === "string"
            ? element.className
            : String((element.className as SVGAnimatedString | undefined)?.baseVal ?? "");

        for (const attribute of Array.from(element.attributes)) {
          attributes[attribute.name] = attribute.value;
        }

        for (const field of args.styleFields) {
          styles[field] = computed.getPropertyValue(field);
        }

        const input = element as HTMLInputElement;
        const selectorValue = args.selector ?? describeElement(element, args.index);
        const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        const markup = element.outerHTML.replace(/\s+/g, " ").trim();

        return {
          selector: selectorValue,
          tag: element.tagName.toLowerCase(),
          text: text.slice(0, 500),
          className,
          attributes,
          markup: markup.slice(0, 2000),
          rect: {
            left: round(rect.left),
            top: round(rect.top),
            width: round(rect.width),
            height: round(rect.height)
          },
          styles,
          state: {
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              computed.display !== "none" &&
              computed.visibility !== "hidden" &&
              computed.opacity !== "0",
            disabled: "disabled" in element ? Boolean(input.disabled) : undefined,
            checked: "checked" in element ? Boolean(input.checked) : undefined,
            value: "value" in element ? input.value : undefined,
            role: element.getAttribute("role") ?? undefined,
            ariaLabel: element.getAttribute("aria-label") ?? undefined,
            testId: element.getAttribute("data-testid") ?? undefined
          }
        };

        function describeElement(target: HTMLElement, fallbackIndex?: number): string {
          const id = target.getAttribute("id");
          if (id) {
            return `#${escapeCss(id)}`;
          }

          const testId = target.getAttribute("data-testid");
          if (testId) {
            return `[data-testid="${escapeAttribute(testId)}"]`;
          }

          const ariaLabel = target.getAttribute("aria-label");
          if (ariaLabel) {
            return `[aria-label="${escapeAttribute(ariaLabel)}"]`;
          }

          const classSelector = Array.from(target.classList)
            .slice(0, 2)
            .map((item) => `.${escapeCss(item)}`)
            .join("");

          if (classSelector) {
            return `${target.tagName.toLowerCase()}${classSelector}`;
          }

          if (target.parentElement) {
            const siblings = Array.from(target.parentElement.children).filter(
              (sibling) => sibling.tagName === target.tagName
            );
            const indexInType = siblings.indexOf(target) + 1;
            return `${target.tagName.toLowerCase()}:nth-of-type(${indexInType})`;
          }

          return `${target.tagName.toLowerCase()}:nth(${fallbackIndex ?? 0})`;
        }

        function escapeCss(value: string): string {
          if (typeof CSS !== "undefined" && CSS.escape) {
            return CSS.escape(value);
          }
          return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        }

        function escapeAttribute(value: string): string {
          return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        }

        function round(value: number): number {
          return Math.round(value * 100) / 100;
        }
      },
      { selector, index, styleFields: STYLE_FIELDS }
    );

    return {
      selector: captured.selector,
      ...(captured.tag ? { tag: captured.tag } : {}),
      ...(captured.text !== undefined ? { text: captured.text } : {}),
      ...(captured.className !== undefined ? { className: captured.className } : {}),
      ...(captured.attributes ? { attributes: captured.attributes } : {}),
      ...(captured.markup ? { markup: captured.markup } : {}),
      ...(captured.rect ? { rect: captured.rect } : {}),
      ...(captured.styles ? { styles: captured.styles } : {}),
      ...(captured.state ? { state: captured.state } : {})
    };
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
    const url = this.page.url();
    const [title, viewport, scroll] = await Promise.all([
      this.page.title().catch(() => undefined),
      Promise.resolve(this.page.viewportSize() ?? undefined),
      this.page
        .evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
        .catch(() => undefined)
    ]);
    const query = parseQuery(url);

    return {
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      ...(query ? { query } : {}),
      ...(viewport ? { viewport } : {}),
      ...(scroll ? { scroll } : {})
    };
  }

  private attachListeners(page: Page): void {
    page.on("console", (message) => {
      this.pushConsole(toConsoleEntry(message));
    });

    page.on("pageerror", (error) => {
      this.pushError(normalizeUnknownError(error, "pageerror"));
    });

    page.on("requestfailed", (request) => {
      const failure = request.failure();
      this.pushError({
        source: "request",
        message: `${request.method()} ${request.url()} failed: ${failure?.errorText ?? "unknown"}`
      });
    });
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

function browserType(name: "chromium" | "firefox" | "webkit"): BrowserType {
  if (name === "firefox") {
    return firefox;
  }
  if (name === "webkit") {
    return webkit;
  }
  return chromium;
}

function contextOptions(config: PeekitTargetConfig): Parameters<Browser["newContext"]>[0] {
  return {
    ...(config.viewport ? { viewport: config.viewport } : {})
  };
}

function parseQuery(url: string): Record<string, string> | undefined {
  try {
    const parsed = new URL(url);
    const query = Object.fromEntries(parsed.searchParams.entries());
    return Object.keys(query).length > 0 ? query : undefined;
  } catch {
    return undefined;
  }
}

function toConsoleEntry(message: ConsoleMessage): ConsoleEntry {
  const location = message.location();
  const locationText = location.url
    ? `${location.url}:${location.lineNumber}:${location.columnNumber}`
    : undefined;

  return {
    type: message.type(),
    text: message.text(),
    ...(locationText ? { location: locationText } : {})
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported interaction action: ${String(value)}`);
}

function isElementEvidence(value: unknown): value is ElementEvidence {
  return typeof value === "object" && value !== null && "selector" in value;
}

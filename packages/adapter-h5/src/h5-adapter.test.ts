import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AdapterSession, PeekitTargetConfig, RuntimeEvidence } from "@peekit/core";
import { createH5Adapter } from "./index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = resolve(repoRoot, "examples/h5-basic/index.html");

describe("H5Adapter integration", () => {
  let server: Server;
  let baseUrl: string;
  const sessions: ManagedSession[] = [];

  beforeAll(async () => {
    const fixtureHtml = withIntegrationFixture(await readFile(fixturePath, "utf8"));

    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/" || url.pathname === "/contract") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(fixtureHtml);
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });

    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to start H5 integration fixture server");
    }

    baseUrl = `http://127.0.0.1:${address.port}/contract?mode=test`;
  });

  afterEach(async () => {
    const openSessions = sessions.splice(0);
    await Promise.all(
      openSessions.map(async ({ session, cleanup }) => {
        await session.close();
        await cleanup();
      })
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });
  });

  it("captures current page and detailed element evidence", async () => {
    const session = await openSession(baseUrl);
    const page = await session.getCurrentPage();

    expectEvidenceShape(page);
    expect(page.page.url).toBe(baseUrl);
    expect(page.page.title).toBe("Peekit H5 Basic");
    expect(page.page.query).toEqual({ mode: "test" });
    expect(page.page.viewport).toEqual({ width: 390, height: 844 });
    expect(page.page.scroll).toEqual({ x: 0, y: 0 });

    const button = await session.queryElement("#submit");

    expectEvidenceShape(button);
    expect(button.element).toMatchObject({
      selector: "#submit",
      tag: "button",
      text: "Submit",
      className: "",
      attributes: {
        id: "submit",
        "data-testid": "submit-button"
      },
      state: {
        visible: true,
        disabled: false,
        testId: "submit-button"
      }
    });
    expect(button.element?.markup).toContain("data-testid=\"submit-button\"");
    expect(button.element?.rect?.width).toBeGreaterThan(0);
    expect(button.element?.rect?.height).toBeGreaterThan(0);
    expect(button.element?.styles?.["background-color"]).toBe("rgb(18, 100, 216)");
  });

  it("queries multiple elements and captures selected snapshots with screenshots", async () => {
    const session = await openSession(baseUrl);

    const results = await session.queryAll("[data-testid]", { maxResults: 2 });
    expect(results).toHaveLength(2);
    expect(results[0]?.element?.selector).toBe("[data-testid]");
    expect(results[0]?.element?.attributes?.["data-testid"]).toBe("submit-button");
    expect(results[1]?.element?.attributes?.["data-testid"]).toBe("status");

    const snapshot = await session.captureSnapshot({
      selectors: ["#submit", "[data-testid='status']"],
      includeScreenshot: true
    });

    expectEvidenceShape(snapshot);
    expect(snapshot.kind).toBe("snapshot");
    expect(snapshot.elements).toHaveLength(2);
    expect(snapshot.elements[0]?.selector).toBe("#submit");
    expect(snapshot.elements[1]?.text).toBe("Idle");
    expect(snapshot.screenshot?.mimeType).toBe("image/png");
    expect(snapshot.screenshot?.data?.length).toBeGreaterThan(100);
  });

  it("performs click interactions and records console output", async () => {
    const session = await openSession(baseUrl);

    const interaction = await session.performInteraction({
      action: "click",
      selector: "#submit",
      waitAfterMs: 50
    });

    expectEvidenceShape(interaction);
    expect(interaction.interaction?.action).toBe("click");
    expect(interaction.interaction?.before).toMatchObject({
      text: "Submit",
      className: ""
    });
    expect(interaction.interaction?.after).toMatchObject({
      text: "Loading",
      className: "loading"
    });
    expect(interaction.element?.text).toBe("Loading");
    expect(interaction.element?.className).toBe("loading");
    expect(interaction.console).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "info",
          text: "submit clicked"
        })
      ])
    );

    const status = await session.queryElement("[data-testid='status']");
    expect(status.element?.text).toBe("Request in progress");
  });

  it("performs input and page scroll interactions", async () => {
    const session = await openSession(baseUrl);

    const input = await session.performInteraction({
      action: "input",
      selector: "#name",
      value: "Ada Lovelace",
      waitAfterMs: 50
    });

    expect(input.element?.state?.value).toBe("Ada Lovelace");
    expect(input.element?.attributes?.["data-testid"]).toBe("name-input");

    await session.performInteraction({
      action: "scroll",
      scroll: { y: 700 },
      waitAfterMs: 50
    });

    const page = await session.getCurrentPage();
    expect(page.page.scroll?.y).toBeGreaterThan(0);
  });

  it("returns explicit DOM errors for missing elements", async () => {
    const session = await openSession(baseUrl);

    const missing = await session.queryElement("#missing");

    expectEvidenceShape(missing);
    expect(missing.element?.selector).toBe("#missing");
    expect(missing.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "dom",
          message: "Element not found: #missing"
        })
      ])
    );
  });

  async function openSession(url: string): Promise<AdapterSession> {
    const browserLaunch = await createBrowserLaunch();
    const session = await createH5Adapter().connect({
      type: "h5",
      id: "h5:integration",
      url,
      browser: "chromium",
      viewport: { width: 390, height: 844 },
      timeoutMs: 15_000,
      ...browserLaunch.config
    });
    sessions.push({ session, cleanup: browserLaunch.cleanup });
    return session;
  }
});

type ManagedSession = {
  session: AdapterSession;
  cleanup: () => Promise<void>;
};

type BrowserLaunch = {
  config: Pick<PeekitTargetConfig, "headless" | "connectOverCDP">;
  cleanup: () => Promise<void>;
};

async function createBrowserLaunch(): Promise<BrowserLaunch> {
  if (existsSync(chromium.executablePath())) {
    return {
      config: { headless: true },
      cleanup: async () => undefined
    };
  }

  const executablePath = findSystemChromium();
  if (!executablePath) {
    throw new Error(
      "Playwright Chromium is not installed and no system Chrome executable was found. " +
        "Run `pnpm --filter @peekit/adapter-h5 exec playwright install chromium` " +
        "or set PEEKIT_H5_TEST_CHROME to a Chromium executable."
    );
  }

  const port = await getFreePort();
  const userDataDir = await mkdtemp(resolve(tmpdir(), "peekit-h5-"));
  const process = spawn(
    executablePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank"
    ],
    {
      stdio: "ignore",
      windowsHide: true
    }
  );

  const endpoint = `http://127.0.0.1:${port}`;
  await waitForCdpEndpoint(endpoint, process);

  return {
    config: { connectOverCDP: endpoint },
    cleanup: async () => {
      if (!process.killed) {
        process.kill();
      }
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

function findSystemChromium(): string | undefined {
  const candidates = [
    process.env.PEEKIT_H5_TEST_CHROME,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    resolve(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate));
}

async function getFreePort(): Promise<number> {
  const server = createTcpServer();

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
  });

  if (!address || typeof address === "string") {
    throw new Error("Unable to allocate a local CDP port");
  }

  return address.port;
}

async function waitForCdpEndpoint(endpoint: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`System Chromium exited before CDP became available: ${process.exitCode}`);
    }

    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(
    `System Chromium CDP endpoint was not ready at ${endpoint}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

function expectEvidenceShape(evidence: RuntimeEvidence): void {
  expect(evidence.target).toBe("h5:integration");
  expect(evidence.capabilityLevel).toBe(4);
  expect(evidence.page).toEqual(expect.any(Object));
  expect(evidence.console).toEqual(expect.any(Array));
  expect(evidence.errors).toEqual(expect.any(Array));
}

function withIntegrationFixture(html: string): string {
  return html
    .replace(
      "</style>",
      `
      .field {
        display: block;
        margin-top: 24px;
      }

      input {
        display: block;
        width: 240px;
        height: 32px;
        margin-top: 8px;
        padding: 0 8px;
      }

      .scroll-spacer {
        height: 1400px;
      }
    </style>`
    )
    .replace(
      "</main>",
      `
      <label class="field" for="name">Name</label>
      <input id="name" data-testid="name-input" value="" />
      <div class="scroll-spacer" data-testid="scroll-spacer">Scroll fixture</div>
    </main>`
    );
}

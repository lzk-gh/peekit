import { access, readdir, readFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import type {
  EnvironmentInspection,
  McpClientInspection,
  PackageManager,
  PortInspection,
  SetupBlocker,
  TargetKind,
  ToolchainInspection
} from "./types.js";

type PackageJsonShape = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type CommandName = "pnpm" | "npm" | "yarn" | "bun";

const FRAMEWORK_PACKAGES: Record<string, string> = {
  vite: "vite",
  next: "next",
  nuxt: "nuxt",
  react: "react",
  vue: "vue",
  svelte: "svelte",
  "@angular/core": "angular",
  "@tarojs/taro": "taro",
  "@remax/core": "remax",
  "@dcloudio/uni-app": "uni-app"
};

const MINI_PROGRAM_HINTS: Array<{ platform: TargetKind; file: string }> = [
  { platform: "mp-weixin", file: "project.config.json" },
  { platform: "mp-weixin", file: "miniprogram/app.json" },
  { platform: "mp-alipay", file: "mini.project.json" },
  { platform: "mp-bytedance", file: "project.tt.json" },
  { platform: "mp-qq", file: "project.qq.json" }
];

export async function inspectProjectEnvironment(
  cwd = process.cwd()
): Promise<EnvironmentInspection> {
  const root = resolve(cwd);
  const packageJson = await readPackageJson(root);
  const packageManager = await detectPackageManager(root);
  const blockers: string[] = [];
  const setupBlockers: SetupBlocker[] = [];

  if (!packageJson) {
    blockers.push("package.json was not found");
    setupBlockers.push({
      code: "missing_package_json",
      severity: "warning",
      message: "package.json was not found in the inspected project directory.",
      remediation: "Run Peekit from the project root or pass cwd to peekit_inspect_environment."
    });
  }

  const scripts = packageJson?.scripts ?? {};
  const allDependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };
  const frameworks = Object.entries(FRAMEWORK_PACKAGES)
    .filter(([packageName]) => packageName in allDependencies)
    .map(([, framework]) => framework);

  const devServerHints = Object.entries(scripts)
    .filter(([script, command]) => isDevScript(script, command))
    .map(([script, command]) => ({
      script,
      command,
      likelyUrl: inferLikelyUrl(command, frameworks)
    }));

  const miniProgramHints = (
    await Promise.all(
      MINI_PROGRAM_HINTS.map(async (hint) => ({
        ...hint,
        exists: await pathExists(join(root, hint.file))
      }))
    )
  )
    .filter((hint) => hint.exists)
    .map(({ platform, file }) => ({ platform, file }));

  if (devServerHints.length === 0 && miniProgramHints.length === 0) {
    blockers.push("no H5 dev server script or mini program project hint was detected");
    setupBlockers.push({
      code: "missing_dev_server",
      severity: "warning",
      message: "No H5 dev server script or mini program project config was detected.",
      remediation: "Add a dev/start script or pass an explicit H5 URL or mini program target config."
    });
  }

  const toolchain = await inspectToolchain(packageManager);
  const ports = await inspectPorts(devServerHints);
  const mcpClients = await inspectMcpClients();

  for (const port of ports) {
    if (!port.reachable) {
      setupBlockers.push({
        code: "port_unreachable",
        severity: "warning",
        message: `Peekit inferred ${port.url}, but it is not reachable on loopback.`,
        remediation: `Start the dev server for ${port.source} or provide the correct URL.`,
        target: "h5",
        evidence: {
          url: port.url,
          reason: port.reason
        }
      });
    }
  }

  if (devServerHints.length > 0 && !toolchain.browsers.some((browser) => browser.available)) {
    setupBlockers.push({
      code: "missing_tool",
      severity: "warning",
      message: "H5 dev server scripts were detected, but no Playwright Chromium, Chrome, or Edge runtime was found.",
      remediation:
        "Install Playwright Chromium or a local Chrome/Edge browser, or provide an explicit browser/CDP target.",
      target: "h5",
      evidence: {
        searchedPaths: toolchain.playwright.searchedPaths
      }
    });
  }

  if (
    miniProgramHints.some((hint) => hint.platform === "mp-weixin") &&
    !toolchain.miniProgramDevTools.some((tool) => tool.platform === "mp-weixin" && tool.available)
  ) {
    setupBlockers.push({
      code: "missing_tool",
      severity: "warning",
      message: "Weixin mini program project files were detected, but Weixin Developer Tools CLI was not found.",
      remediation:
        "Install Weixin Developer Tools or set WECHAT_DEVTOOLS_CLI to the CLI executable path.",
      target: "mp-weixin"
    });
  }

  return {
    cwd: root,
    packageManager,
    packageJson: packageJson
      ? {
          name: packageJson.name,
          scripts,
          dependencies: packageJson.dependencies ?? {},
          devDependencies: packageJson.devDependencies ?? {}
        }
      : undefined,
    frameworks: [...new Set(frameworks)],
    devServerHints,
    miniProgramHints,
    blockers,
    setupBlockers,
    toolchain,
    ports,
    mcpClients,
    security: {
      policy: "safe-local-discovery",
      inspected: [
        "project package.json, lockfiles, and known mini program config filenames",
        "PATH and selected environment variables for tool discovery",
        "common browser and Weixin Developer Tools install locations",
        "loopback-only dev server URLs inferred from package scripts",
        "known MCP client config path existence"
      ],
      skipped: [
        "full disk scans",
        "SSH keys, tokens, and browser profiles",
        "MCP client/editor config file contents",
        "public or LAN network scanning",
        "automatic writes to editor or MCP client configuration"
      ]
    }
  };
}

async function readPackageJson(root: string): Promise<PackageJsonShape | undefined> {
  try {
    const raw = await readFile(join(root, "package.json"), "utf8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

async function detectPackageManager(root: string): Promise<PackageManager | undefined> {
  if (await pathExists(join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await pathExists(join(root, "package-lock.json"))) {
    return "npm";
  }
  if (await pathExists(join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (await pathExists(join(root, "bun.lockb")) || (await pathExists(join(root, "bun.lock")))) {
    return "bun";
  }
  return undefined;
}

async function inspectToolchain(
  packageManager: PackageManager | undefined
): Promise<ToolchainInspection> {
  const packageManagers = await Promise.all(
    (["pnpm", "npm", "yarn", "bun"] satisfies CommandName[]).map(async (name) => {
      const path = await findExecutable([name]);
      return {
        name,
        selected: packageManager === name,
        available: Boolean(path),
        path
      };
    })
  );
  const playwright = await inspectPlaywright();
  const browsers = await inspectBrowsers(playwright);
  const miniProgramDevTools = await inspectMiniProgramDevTools();

  return {
    system: {
      platform: process.platform,
      arch: process.arch,
      shell: process.env.SHELL ?? process.env.ComSpec ?? process.env.COMSPEC
    },
    node: {
      version: process.version,
      execPath: process.execPath
    },
    packageManagers,
    playwright,
    browsers,
    miniProgramDevTools
  };
}

async function inspectPlaywright(): Promise<ToolchainInspection["playwright"]> {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
      : undefined,
    process.platform === "darwin"
      ? join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright")
      : undefined,
    process.platform !== "win32" && process.platform !== "darwin"
      ? join(process.env.HOME ?? "", ".cache", "ms-playwright")
      : undefined
  ].filter((path): path is string => Boolean(path && path !== "0"));
  const searchedPaths = [...new Set(candidates)];
  let browsersPath: string | undefined;
  let chromiumAvailable = false;

  for (const path of searchedPaths) {
    if (!(await pathExists(path))) {
      continue;
    }

    browsersPath = path;
    const entries = await readdir(path).catch(() => []);
    if (entries.some((entry) => entry.startsWith("chromium"))) {
      chromiumAvailable = true;
      break;
    }
  }

  return {
    browsersPath,
    chromiumAvailable,
    searchedPaths
  };
}

async function inspectBrowsers(
  playwright: ToolchainInspection["playwright"]
): Promise<ToolchainInspection["browsers"]> {
  const browsers: ToolchainInspection["browsers"] = [];

  if (playwright.chromiumAvailable) {
    browsers.push({
      name: "chromium",
      available: true,
      path: playwright.browsersPath,
      source: "playwright-cache"
    });
  }

  const envChrome = process.env.PEEKIT_H5_TEST_CHROME ?? process.env.CHROME_PATH;
  if (envChrome && (await pathExists(envChrome))) {
    browsers.push({ name: "chrome", available: true, path: envChrome, source: "env" });
  }

  const pathChrome = await findExecutable(["chrome", "chrome.exe", "google-chrome", "chromium"]);
  if (pathChrome) {
    browsers.push({ name: "chrome", available: true, path: pathChrome, source: "path" });
  }

  const pathEdge = await findExecutable(["msedge", "msedge.exe"]);
  if (pathEdge) {
    browsers.push({ name: "edge", available: true, path: pathEdge, source: "path" });
  }

  for (const candidate of commonBrowserPaths()) {
    if (candidate.path && (await pathExists(candidate.path))) {
      browsers.push(candidate);
    }
  }

  return dedupeByPath(browsers);
}

async function inspectMiniProgramDevTools(): Promise<ToolchainInspection["miniProgramDevTools"]> {
  const tools: ToolchainInspection["miniProgramDevTools"] = [];
  const envCli = process.env.WECHAT_DEVTOOLS_CLI;
  if (envCli && (await pathExists(envCli))) {
    tools.push({
      platform: "mp-weixin",
      name: "Weixin Developer Tools CLI",
      available: true,
      cliPath: envCli,
      source: "env"
    });
  }

  const pathCli = await findExecutable(["cli", "cli.bat", "wechatdevtools", "wechatwebdevtools"]);
  if (pathCli) {
    tools.push({
      platform: "mp-weixin",
      name: "Weixin Developer Tools CLI",
      available: true,
      cliPath: pathCli,
      source: "path"
    });
  }

  for (const candidate of commonWeixinCliPaths()) {
    if (await pathExists(candidate)) {
      tools.push({
        platform: "mp-weixin",
        name: "Weixin Developer Tools CLI",
        available: true,
        cliPath: candidate,
        source: "common-path"
      });
    }
  }

  return dedupeByPath(tools);
}

async function inspectPorts(
  devServerHints: EnvironmentInspection["devServerHints"]
): Promise<PortInspection[]> {
  const ports: PortInspection[] = [];

  for (const hint of devServerHints) {
    if (!hint.likelyUrl) {
      continue;
    }
    ports.push(await inspectLoopbackUrl(hint.likelyUrl, hint.script));
  }

  return ports;
}

async function inspectLoopbackUrl(url: string, source: string): Promise<PortInspection> {
  const parsed = new URL(url);
  const port = Number.parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10);
  const base = {
    url,
    host: parsed.hostname,
    port,
    protocol: parsed.protocol as "http:" | "https:",
    source
  };

  if (!isLoopbackHost(parsed.hostname)) {
    return {
      ...base,
      reachable: false,
      reason: "skipped_non_loopback"
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 700);
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);

    return {
      ...base,
      reachable: true,
      status: response.status
    };
  } catch (error) {
    return {
      ...base,
      reachable: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

async function inspectMcpClients(): Promise<McpClientInspection[]> {
  const candidates = knownMcpClientConfigPaths();

  return Promise.all(
    candidates.map(async ({ name, configPath }) => ({
      name,
      configPath,
      exists: await pathExists(configPath),
      contentRead: false as const
    }))
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(names: string[]): Promise<string | undefined> {
  const paths = (process.env.PATH ?? "")
    .split(delimiter)
    .map((path) => path.trim())
    .filter(Boolean);
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];

  for (const dir of paths) {
    for (const name of names) {
      const candidates = name.includes(".")
        ? [join(dir, name)]
        : extensions.map((extension) => join(dir, `${name}${extension.toLowerCase()}`));
      for (const candidate of candidates) {
        if (await pathExists(candidate)) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

function isDevScript(script: string, command: string): boolean {
  const haystack = `${script} ${command}`.toLowerCase();
  return /\b(dev|serve|start)\b/.test(haystack) && /(vite|next|nuxt|webpack|rsbuild|serve|astro)/.test(haystack);
}

function inferLikelyUrl(command: string, frameworks: string[]): string | undefined {
  const explicitPort = command.match(/(?:--port|-p)\s+(\d+)/)?.[1];
  const localhostPort = command.match(/localhost:(\d+)/)?.[1];
  const port = explicitPort ?? localhostPort;

  if (port) {
    return `http://localhost:${port}`;
  }

  if (frameworks.includes("vite") || frameworks.includes("vue") || frameworks.includes("svelte")) {
    return "http://localhost:5173";
  }

  if (frameworks.includes("next") || frameworks.includes("nuxt")) {
    return "http://localhost:3000";
  }

  return undefined;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function commonBrowserPaths(): ToolchainInspection["browsers"] {
  const paths: ToolchainInspection["browsers"] = [];
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const home = process.env.HOME ?? "";

  if (process.platform === "win32") {
    paths.push(
      {
        name: "chrome",
        available: true,
        path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        source: "common-path"
      },
      {
        name: "chrome",
        available: true,
        path: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        source: "common-path"
      },
      {
        name: "chrome",
        available: true,
        path: join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        source: "common-path"
      },
      {
        name: "edge",
        available: true,
        path: "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        source: "common-path"
      }
    );
  } else if (process.platform === "darwin") {
    paths.push(
      {
        name: "chrome",
        available: true,
        path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        source: "common-path"
      },
      {
        name: "edge",
        available: true,
        path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        source: "common-path"
      }
    );
  } else {
    paths.push(
      { name: "chrome", available: true, path: "/usr/bin/google-chrome", source: "common-path" },
      { name: "chrome", available: true, path: "/usr/bin/chromium", source: "common-path" },
      { name: "chrome", available: true, path: join(home, ".local", "bin", "chromium"), source: "common-path" }
    );
  }

  return paths;
}

function commonWeixinCliPaths(): string[] {
  if (process.platform === "win32") {
    return [
      "C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat",
      "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
      "C:\\Program Files\\Tencent\\微信开发者工具\\cli.bat",
      "C:\\Program Files (x86)\\Tencent\\微信开发者工具\\cli.bat"
    ];
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/wechatwebdevtools.app/Contents/MacOS/cli",
      "/Applications/微信开发者工具.app/Contents/MacOS/cli"
    ];
  }

  return [];
}

function knownMcpClientConfigPaths(): Array<{ name: string; configPath: string }> {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const appData = process.env.APPDATA ?? "";

  return [
    { name: "Claude Desktop", configPath: join(appData, "Claude", "claude_desktop_config.json") },
    { name: "Cursor", configPath: join(home, ".cursor", "mcp.json") },
    { name: "Cursor", configPath: join(appData, "Cursor", "User", "mcp.json") },
    { name: "VS Code", configPath: join(appData, "Code", "User", "mcp.json") },
    { name: "Windsurf", configPath: join(home, ".codeium", "windsurf", "mcp_config.json") }
  ].filter((candidate) => candidate.configPath.trim().length > 0);
}

function dedupeByPath<T extends { path?: string; cliPath?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = item.path ?? item.cliPath ?? JSON.stringify(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

import { access, readdir, readFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import type {
  EditorAppInspection,
  EnvironmentInspection,
  McpClientInspection,
  PackageManager,
  PortInspection,
  SetupBlocker,
  SetupManifestInspection,
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

type SetupManifestShape = {
  h5?: unknown;
  weixin?: unknown;
  mcpClients?: unknown;
  editorApps?: unknown;
};

type NormalizedSetupManifest = SetupManifestInspection["provided"];
type SetupManifestSource = SetupManifestInspection["sources"][number] & {
  provided: NormalizedSetupManifest;
};

const DEFAULT_SETUP_MANIFEST_PATH = join(".peekit", "local-setup.json");

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
  const setupManifest = await readSetupManifest(root);
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

  if (setupManifest.exists && !setupManifest.valid) {
    blockers.push("Peekit local setup manifest could not be parsed");
    setupBlockers.push({
      code: "invalid_setup_manifest",
      severity: "warning",
      message: "Peekit local setup manifest could not be parsed.",
      remediation:
        "Fix .peekit/local-setup.json or remove it so Peekit can use safe fallback discovery.",
      evidence: {
        path: setupManifest.path,
        errors: setupManifest.errors
      }
    });
  }

  const toolchain = await inspectToolchain(packageManager, setupManifest);
  const ports = await inspectPorts(devServerHints, setupManifest);
  const mcpClients = await inspectMcpClients(setupManifest);
  const editorApps = await inspectEditorApps(setupManifest);

  for (const port of ports) {
    if (!port.reachable) {
      const nonLoopback = port.reason === "skipped_non_loopback";
      const invalidUrl = port.reason === "invalid_url";
      setupBlockers.push({
        code: invalidUrl ? "invalid_target" : nonLoopback ? "permission_required" : "port_unreachable",
        severity: "warning",
        message: invalidUrl
          ? `Peekit found an invalid H5 URL: ${port.url}`
          : nonLoopback
          ? `Peekit found ${port.url}, but safe discovery does not probe non-loopback hosts.`
          : `Peekit inferred ${port.url}, but it is not reachable on loopback.`,
        remediation: invalidUrl
          ? "Update .peekit/local-setup.json with a valid localhost or 127.0.0.1 URL."
          : nonLoopback
          ? "Use a localhost/127.0.0.1 URL in the setup manifest or target config."
          : `Start the dev server for ${port.source} or provide the correct URL.`,
        target: "h5",
        evidence: {
          url: port.url,
          reason: port.reason
        }
      });
    }
  }

  const needsH5Browser =
    devServerHints.length > 0 || Boolean(setupManifest.provided.h5?.url);
  if (needsH5Browser && !toolchain.browsers.some((browser) => browser.available)) {
    setupBlockers.push({
      code: "missing_tool",
      severity: "warning",
      message: "H5 dev server scripts were detected, but no Playwright Chromium, Chrome, or Edge runtime was found.",
      remediation:
        "Install Playwright Chromium, put browserPath in ~/.peekit/local-setup.json, or provide an explicit CDP target.",
      target: "h5",
      evidence: {
        searchedPaths: toolchain.playwright.searchedPaths
      }
    });
  }

  for (const browser of toolchain.browsers.filter(
    (candidate) => candidate.source === "manifest" && !candidate.available
  )) {
    setupBlockers.push({
      code: "missing_tool",
      severity: "warning",
      message: `Configured H5 browser path does not exist: ${browser.path}`,
      remediation: "Update .peekit/local-setup.json with a valid Chrome, Edge, or Chromium path.",
      target: "h5",
      evidence: {
        path: browser.path
      }
    });
  }

  for (const tool of toolchain.miniProgramDevTools.filter(
    (candidate) => candidate.source === "manifest" && !candidate.available
  )) {
    setupBlockers.push({
      code: "missing_tool",
      severity: "warning",
      message: `Configured Weixin Developer Tools CLI path does not exist: ${tool.cliPath}`,
      remediation: "Update .peekit/local-setup.json with the valid Weixin Developer Tools CLI path.",
      target: "mp-weixin",
      evidence: {
        path: tool.cliPath
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
        "Add weixin.cliPath to ~/.peekit/local-setup.json or set WECHAT_DEVTOOLS_CLI to the CLI executable path.",
      target: "mp-weixin"
    });
  }

  if (
    miniProgramHints.some((hint) => hint.platform === "mp-weixin") &&
    toolchain.miniProgramDevTools.some((tool) => tool.platform === "mp-weixin" && tool.available) &&
    setupManifest.provided.weixin?.automation?.servicePortEnabled !== true
  ) {
    setupBlockers.push({
      code: "permission_required",
      severity: "warning",
      message: "Weixin Developer Tools CLI is configured, but service port automation has not been confirmed.",
      remediation:
        "Open Weixin Developer Tools, enable Settings > Security > Service Port, then set weixin.automation.servicePortEnabled to true in the Peekit setup manifest.",
      target: "mp-weixin",
      evidence: {
        manifestPath: setupManifest.path,
        configured: setupManifest.provided.weixin?.automation?.servicePortEnabled ?? false
      }
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
    setupManifest,
    toolchain,
    ports,
    mcpClients,
    editorApps,
    security: {
      policy: "safe-local-discovery",
      inspected: [
        "user and project Peekit setup manifests before fallback discovery",
        "project package.json, lockfiles, and known mini program config filenames",
        "PATH and selected environment variables for tool discovery",
        "loopback-only dev server URLs inferred from package scripts"
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

async function readSetupManifest(root: string): Promise<SetupManifestInspection> {
  const manifestPaths = await resolveManifestPaths(root);
  const sources = await Promise.all(
    manifestPaths.map((source) => readSetupManifestSource(source.path, source.scope))
  );
  const existingSources = sources.filter((source) => source.exists);
  const projectSource = existingSources.find((source) => source.scope === "project");
  const userSource = existingSources.find((source) => source.scope === "user");
  const effectiveSource = projectSource ?? userSource;
  const errors = sources.flatMap((source) =>
    source.errors.map((error) => `${source.scope}: ${error}`)
  );
  const exposedSources = sources.map(({ provided: _provided, ...source }) => source);

  return {
    path: effectiveSource?.path ?? manifestPaths.find((source) => source.scope === "project")?.path ?? manifestPaths[0]?.path ?? join(root, DEFAULT_SETUP_MANIFEST_PATH),
    scope:
      projectSource && userSource
        ? "merged"
        : projectSource
          ? "project"
          : userSource
            ? "user"
            : "none",
    exists: existingSources.length > 0,
    valid: sources.every((source) => !source.exists || source.valid),
    contentRead: sources.some((source) => source.contentRead),
    errors,
    sources: exposedSources,
    provided: mergeSetupManifests(existingSources.map((source) => source.provided))
  };
}

async function readSetupManifestSource(
  manifestPath: string,
  scope: "user" | "project"
): Promise<SetupManifestSource> {
  let raw: string;

  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    const missing = isNodeError(error) && error.code === "ENOENT";

    return {
      path: manifestPath,
      scope,
      exists: !missing,
      valid: missing,
      contentRead: false,
      errors: missing ? [] : [error instanceof Error ? error.message : String(error)],
      provided: emptySetupManifest()
    };
  }

  try {
    const parsed = JSON.parse(raw) as SetupManifestShape;
    const { provided, errors } = normalizeSetupManifest(parsed);

    return {
      path: manifestPath,
      scope,
      exists: true,
      valid: errors.length === 0,
      contentRead: true,
      errors,
      provided
    };
  } catch (error) {
    return {
      path: manifestPath,
      scope,
      exists: true,
      valid: false,
      contentRead: true,
      errors: [error instanceof Error ? error.message : String(error)],
      provided: emptySetupManifest()
    };
  }
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
  packageManager: PackageManager | undefined,
  setupManifest: SetupManifestInspection
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
  const browsers = await inspectBrowsers(playwright, setupManifest);
  const miniProgramDevTools = await inspectMiniProgramDevTools(setupManifest);

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
  playwright: ToolchainInspection["playwright"],
  setupManifest: SetupManifestInspection
): Promise<ToolchainInspection["browsers"]> {
  const browsers: ToolchainInspection["browsers"] = [];
  const manifestBrowserPath = setupManifest.provided.h5?.browserPath;

  if (manifestBrowserPath) {
    browsers.push({
      name: inferBrowserName(manifestBrowserPath),
      available: await pathExists(manifestBrowserPath),
      path: manifestBrowserPath,
      source: "manifest"
    });
  }

  if (browsers.some((browser) => browser.source === "manifest" && browser.available)) {
    return dedupeByPath(browsers);
  }

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

  return dedupeByPath(browsers);
}

async function inspectMiniProgramDevTools(
  setupManifest: SetupManifestInspection
): Promise<ToolchainInspection["miniProgramDevTools"]> {
  const tools: ToolchainInspection["miniProgramDevTools"] = [];
  const manifestCli = setupManifest.provided.weixin?.cliPath;
  if (manifestCli) {
    tools.push({
      platform: "mp-weixin",
      name: "Weixin Developer Tools CLI",
      available: await pathExists(manifestCli),
      cliPath: manifestCli,
      source: "manifest"
    });
  }

  if (tools.some((tool) => tool.source === "manifest" && tool.available)) {
    return dedupeByPath(tools);
  }

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

  return dedupeByPath(tools);
}

async function inspectPorts(
  devServerHints: EnvironmentInspection["devServerHints"],
  setupManifest: SetupManifestInspection
): Promise<PortInspection[]> {
  const ports: PortInspection[] = [];
  const manifestUrl = setupManifest.provided.h5?.url;

  if (manifestUrl) {
    return [await inspectLoopbackUrl(manifestUrl, "manifest")];
  }

  for (const hint of devServerHints) {
    if (!hint.likelyUrl) {
      continue;
    }
    ports.push(await inspectLoopbackUrl(hint.likelyUrl, hint.script));
  }

  return ports;
}

async function inspectLoopbackUrl(url: string, source: string): Promise<PortInspection> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      url,
      host: "",
      port: 0,
      protocol: "http:",
      reachable: false,
      reason: "invalid_url",
      source
    };
  }

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

async function inspectMcpClients(
  setupManifest: SetupManifestInspection
): Promise<McpClientInspection[]> {
  const manifestClients = setupManifest.provided.mcpClients.filter((client) => client.configPath);

  if (manifestClients.length > 0) {
    return Promise.all(
      manifestClients.map(async (client) => ({
        name: client.name,
        configPath: client.configPath ?? "",
        exists: client.configPath ? await pathExists(client.configPath) : false,
        contentRead: false as const,
        source: "manifest" as const,
        ...(client.appPath ? { appPath: client.appPath, appExists: await pathExists(client.appPath) } : {})
      }))
    );
  }

  return [];
}

async function inspectEditorApps(
  setupManifest: SetupManifestInspection
): Promise<EditorAppInspection[]> {
  return Promise.all(
    setupManifest.provided.editorApps.map(async (app) => ({
      name: app.name,
      appPath: app.appPath,
      exists: await pathExists(app.appPath),
      source: "manifest" as const
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

async function resolveManifestPaths(root: string): Promise<Array<{ path: string; scope: "user" | "project" }>> {
  const configured = process.env.PEEKIT_SETUP_MANIFEST;
  if (!configured) {
    return dedupeManifestPaths([
      ...userSetupManifestPath().map((path) => ({ path, scope: "user" as const })),
      { path: await findNearestSetupManifest(root), scope: "project" as const }
    ]);
  }
  return [{ path: resolve(root, configured), scope: "project" }];
}

async function findNearestSetupManifest(root: string): Promise<string> {
  let current = root;

  while (true) {
    const candidate = join(current, DEFAULT_SETUP_MANIFEST_PATH);
    if (await pathExists(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return join(root, DEFAULT_SETUP_MANIFEST_PATH);
    }
    current = parent;
  }
}

function userSetupManifestPath(): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  return home ? [join(home, DEFAULT_SETUP_MANIFEST_PATH)] : [];
}

function dedupeManifestPaths(
  sources: Array<{ path: string; scope: "user" | "project" }>
): Array<{ path: string; scope: "user" | "project" }> {
  const seen = new Set<string>();
  const result: Array<{ path: string; scope: "user" | "project" }> = [];

  for (const source of sources) {
    const key = source.path.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(source);
  }

  return result;
}

function mergeSetupManifests(manifests: NormalizedSetupManifest[]): NormalizedSetupManifest {
  return manifests.reduce<NormalizedSetupManifest>((merged, manifest) => ({
    ...(merged.h5 || manifest.h5
      ? {
          h5: {
            ...(merged.h5 ?? {}),
            ...(manifest.h5 ?? {})
          }
        }
      : {}),
    ...(merged.weixin || manifest.weixin
      ? {
          weixin: {
            ...(merged.weixin ?? {}),
            ...(manifest.weixin ?? {}),
            ...((merged.weixin?.automation || manifest.weixin?.automation)
              ? {
                  automation: {
                    ...(merged.weixin?.automation ?? {}),
                    ...(manifest.weixin?.automation ?? {})
                  }
                }
              : {})
          }
        }
      : {}),
    mcpClients: [...merged.mcpClients, ...manifest.mcpClients],
    editorApps: [...merged.editorApps, ...manifest.editorApps]
  }), emptySetupManifest());
}

function normalizeSetupManifest(input: unknown): {
  provided: NormalizedSetupManifest;
  errors: string[];
} {
  const errors: string[] = [];
  const manifest = asRecord(input);

  if (!manifest) {
    return {
      provided: emptySetupManifest(),
      errors: ["setup manifest must be a JSON object"]
    };
  }

  const h5 = asRecord(manifest.h5);
  const weixin = asRecord(manifest.weixin);
  const h5Url = h5 ? readOptionalString(h5, "url", errors, "h5.url") : undefined;
  const h5ConnectOverCDP = h5
    ? readOptionalString(h5, "connectOverCDP", errors, "h5.connectOverCDP")
    : undefined;
  const h5BrowserPath = h5
    ? readOptionalString(h5, "browserPath", errors, "h5.browserPath")
    : undefined;
  const weixinCliPath = weixin
    ? readOptionalString(weixin, "cliPath", errors, "weixin.cliPath")
    : undefined;
  const weixinProjectPath = weixin
    ? readOptionalString(weixin, "projectPath", errors, "weixin.projectPath")
    : undefined;
  const weixinAutomation = weixin ? asRecord(weixin.automation) : undefined;
  const weixinServicePortEnabled = weixinAutomation
    ? readOptionalBoolean(
        weixinAutomation,
        "servicePortEnabled",
        errors,
        "weixin.automation.servicePortEnabled"
      )
    : undefined;
  const weixinAutomationPort = weixinAutomation
    ? readOptionalPositiveInteger(weixinAutomation, "port", errors, "weixin.automation.port")
    : undefined;

  return {
    provided: {
      ...(h5
        ? {
            h5: {
              ...(h5Url ? { url: h5Url } : {}),
              ...(h5ConnectOverCDP ? { connectOverCDP: h5ConnectOverCDP } : {}),
              ...(h5BrowserPath ? { browserPath: h5BrowserPath } : {})
            }
          }
        : {}),
      ...(weixin
        ? {
            weixin: {
              ...(weixinCliPath ? { cliPath: weixinCliPath } : {}),
              ...(weixinProjectPath ? { projectPath: weixinProjectPath } : {}),
              ...(weixinAutomation
                ? {
                    automation: {
                      ...(weixinServicePortEnabled !== undefined
                        ? { servicePortEnabled: weixinServicePortEnabled }
                        : {}),
                      ...(weixinAutomationPort !== undefined ? { port: weixinAutomationPort } : {})
                    }
                  }
                : {})
            }
          }
        : {}),
      mcpClients: readPathList(manifest.mcpClients, "mcpClients", errors),
      editorApps: readEditorApps(manifest.editorApps, errors)
    },
    errors
  };
}

function emptySetupManifest(): NormalizedSetupManifest {
  return {
    mcpClients: [],
    editorApps: []
  };
}

function readPathList(
  value: unknown,
  field: string,
  errors: string[]
): NormalizedSetupManifest["mcpClients"] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }

  return value.flatMap((item, index) => {
    const record = asRecord(item);
    if (!record) {
      errors.push(`${field}[${index}] must be an object`);
      return [];
    }

    const name = readOptionalString(record, "name", errors, `${field}[${index}].name`) ?? "MCP client";
    const configPath = readOptionalString(record, "configPath", errors, `${field}[${index}].configPath`);
    const appPath = readOptionalString(record, "appPath", errors, `${field}[${index}].appPath`);

    if (!configPath && !appPath) {
      errors.push(`${field}[${index}] must include configPath or appPath`);
      return [];
    }

    return [
      {
        name,
        ...(configPath ? { configPath } : {}),
        ...(appPath ? { appPath } : {})
      }
    ];
  });
}

function readEditorApps(value: unknown, errors: string[]): NormalizedSetupManifest["editorApps"] {
  return readPathList(value, "editorApps", errors).flatMap((item, index) => {
    if (!item.appPath) {
      errors.push(`editorApps[${index}] must include appPath`);
      return [];
    }

    return [
      {
        name: item.name,
        appPath: item.appPath
      }
    ];
  });
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path: string
): string | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return undefined;
  }

  return value;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path: string
): boolean | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
    return undefined;
  }

  return value;
}

function readOptionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  path: string
): number | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    errors.push(`${path} must be a positive integer`);
    return undefined;
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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

function inferBrowserName(path: string): "chromium" | "chrome" | "edge" {
  const normalized = path.toLowerCase();
  if (normalized.includes("edge") || normalized.includes("msedge")) {
    return "edge";
  }
  if (normalized.includes("chrome")) {
    return "chrome";
  }
  return "chromium";
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

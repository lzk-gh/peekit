import { access } from "node:fs/promises";
import type {
  EnvironmentInspection,
  PeekitTargetConfig,
  SetupBlocker,
  TargetKind,
  TargetValidationResult
} from "./types.js";

export function suggestTargetConfigs(
  environment: EnvironmentInspection,
  preferredKind?: TargetKind
): PeekitTargetConfig[] {
  const suggestions: PeekitTargetConfig[] = [];

  if (!preferredKind || preferredKind === "h5") {
    const manifestH5 = environment.setupManifest.provided.h5;
    const availableBrowser = environment.toolchain.browsers.find((browser) => browser.available);
    if (manifestH5 && (manifestH5.url || manifestH5.connectOverCDP)) {
      suggestions.push({
        id: "h5:manifest",
        name: "H5 (local setup manifest)",
        type: "h5",
        ...(manifestH5.url ? { url: manifestH5.url } : {}),
        ...(manifestH5.connectOverCDP ? { connectOverCDP: manifestH5.connectOverCDP } : {}),
        rootDir: environment.cwd,
        browser: "chromium",
        ...(manifestH5.browserPath ? { browserPath: manifestH5.browserPath } : {}),
        headless: true,
        metadata: {
          source: "manifest",
          confidence: "high",
          requiresUserAction:
            environment.ports.some((port) => port.source === "manifest" && !port.reachable) ||
            Boolean(
              manifestH5.browserPath &&
                environment.toolchain.browsers.some(
                  (browser) => browser.source === "manifest" && !browser.available
                )
            ),
          ...(manifestH5.browserPath ? { browserPath: manifestH5.browserPath } : {})
        }
      });
    }

    for (const hint of environment.devServerHints) {
      if (manifestH5?.url === hint.likelyUrl) {
        continue;
      }
      suggestions.push({
        id: `h5:${hint.likelyUrl ?? hint.script}`,
        name: `H5 (${hint.script})`,
        type: "h5",
        url: hint.likelyUrl,
        rootDir: environment.cwd,
        browser: "chromium",
        ...(availableBrowser?.path ? { browserPath: availableBrowser.path } : {}),
        headless: true,
        metadata: {
          script: hint.script,
          command: hint.command,
          source: "package-script",
          confidence: hint.likelyUrl ? "high" : "medium",
          requiresUserAction:
            !hint.likelyUrl ||
            environment.ports.some((port) => port.url === hint.likelyUrl && !port.reachable),
          browser: availableBrowser?.name ?? "playwright-chromium"
        }
      });
    }
  }

  const weixinCli = environment.toolchain.miniProgramDevTools.find(
    (tool) => tool.platform === "mp-weixin" && tool.available
  )?.cliPath;
  const manifestWeixin = environment.setupManifest.provided.weixin;

  if ((!preferredKind || preferredKind === "mp-weixin") && manifestWeixin) {
    suggestions.push({
      id: "mp-weixin:manifest",
      name: "mp-weixin (local setup manifest)",
      type: "mp-weixin",
      rootDir: environment.cwd,
      ...(manifestWeixin.projectPath ? { projectPath: manifestWeixin.projectPath } : {}),
      ...(manifestWeixin.cliPath ? { cliPath: manifestWeixin.cliPath } : {}),
      metadata: {
        source: "manifest",
        confidence: manifestWeixin.projectPath && manifestWeixin.cliPath ? "high" : "medium",
        requiresUserAction:
          !manifestWeixin.projectPath ||
          !manifestWeixin.cliPath ||
          environment.toolchain.miniProgramDevTools.some(
            (tool) => tool.source === "manifest" && !tool.available
          )
      }
    });
  }

  for (const hint of environment.miniProgramHints) {
    if (preferredKind && preferredKind !== hint.platform) {
      continue;
    }
    if (hint.platform === "mp-weixin" && manifestWeixin) {
      continue;
    }
    suggestions.push({
      id: `${hint.platform}:${hint.file}`,
      name: `${hint.platform} (${hint.file})`,
      type: hint.platform,
      rootDir: environment.cwd,
      ...(hint.platform === "mp-weixin" ? { projectPath: environment.cwd } : {}),
      ...(hint.platform === "mp-weixin" && weixinCli ? { cliPath: weixinCli } : {}),
      metadata: {
        configFile: hint.file,
        source: "project-config",
        confidence: hint.platform === "mp-weixin" && weixinCli ? "high" : "medium",
        requiresUserAction: hint.platform === "mp-weixin" && !weixinCli
      }
    });
  }

  return suggestions;
}

export async function validateTargetConfig(
  target: PeekitTargetConfig
): Promise<TargetValidationResult> {
  const blockers: string[] = [];
  const setupBlockers: SetupBlocker[] = [];
  const checkedAt = new Date().toISOString();

  if (target.type === "mp-weixin") {
    if (!target.projectPath && !target.rootDir && !target.wsEndpoint) {
      blockers.push("mp-weixin target needs projectPath, rootDir, or wsEndpoint");
      setupBlockers.push({
        code: "invalid_target",
        severity: "error",
        message: "Weixin target needs projectPath, rootDir, or wsEndpoint.",
        remediation: "Pass the mini program project path or an existing Weixin automation wsEndpoint.",
        target: "mp-weixin"
      });
    }
    if (!target.wsEndpoint) {
      if (!target.cliPath) {
        blockers.push("Weixin Developer Tools CLI was not provided or discovered");
        setupBlockers.push({
          code: "missing_tool",
          severity: "error",
          message: "Weixin Developer Tools CLI was not provided or discovered.",
          remediation:
            "Set WECHAT_DEVTOOLS_CLI, add the CLI to PATH, or pass cliPath in the target config.",
          target: "mp-weixin"
        });
      } else if (!(await pathExists(target.cliPath))) {
        blockers.push(`Weixin Developer Tools CLI does not exist: ${target.cliPath}`);
        setupBlockers.push({
          code: "missing_tool",
          severity: "error",
          message: `Weixin Developer Tools CLI does not exist: ${target.cliPath}`,
          remediation: "Pass a valid cliPath or set WECHAT_DEVTOOLS_CLI to the CLI executable.",
          target: "mp-weixin"
        });
      }
    }
    return {
      valid: blockers.length === 0,
      target,
      checkedAt,
      blockers,
      setupBlockers
    };
  }

  if (target.type !== "h5") {
    blockers.push(`${target.type} adapter is planned but not implemented yet`);
    setupBlockers.push({
      code: "unsupported_platform",
      severity: "error",
      message: `${target.type} adapter is planned but not implemented yet.`,
      remediation: "Use H5 or Weixin mini program for the current Peekit MVP.",
      target: target.type
    });
    return {
      valid: false,
      target,
      checkedAt,
      blockers,
      setupBlockers
    };
  }

  if (!target.url && !target.connectOverCDP) {
    blockers.push("h5 target needs url or connectOverCDP");
    setupBlockers.push({
      code: "invalid_target",
      severity: "error",
      message: "H5 target needs url or connectOverCDP.",
      remediation: "Start a dev server and pass its loopback URL, or pass a Chromium CDP endpoint.",
      target: "h5"
    });
    return {
      valid: false,
      target,
      checkedAt,
      blockers,
      setupBlockers
    };
  }

  if (!target.url) {
    return {
      valid: true,
      target,
      checkedAt,
      blockers,
      setupBlockers
    };
  }

  if (target.browserPath && !(await pathExists(target.browserPath))) {
    blockers.push(`browserPath does not exist: ${target.browserPath}`);
    setupBlockers.push({
      code: "missing_tool",
      severity: "error",
      message: `Configured H5 browser path does not exist: ${target.browserPath}`,
      remediation: "Update browserPath in .peekit/local-setup.json or omit it to use Playwright defaults.",
      target: "h5",
      evidence: {
        path: target.browserPath
      }
    });
    return {
      valid: false,
      target,
      checkedAt,
      blockers,
      setupBlockers
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target.url);
  } catch {
    blockers.push(`invalid H5 URL: ${target.url}`);
    setupBlockers.push({
      code: "invalid_target",
      severity: "error",
      message: `Invalid H5 URL: ${target.url}`,
      remediation: "Pass a valid localhost or 127.0.0.1 URL.",
      target: "h5",
      evidence: {
        url: target.url
      }
    });
    return {
      valid: false,
      target,
      checkedAt,
      blockers,
      setupBlockers
    };
  }

  if (!isLoopbackHost(parsedUrl.hostname)) {
    blockers.push("Peekit does not probe non-loopback URLs during safe local validation");
    setupBlockers.push({
      code: "permission_required",
      severity: "error",
      message: "Peekit does not probe non-loopback URLs during safe local validation.",
      remediation: "Use a localhost/127.0.0.1 dev server URL or explicitly connect the target runtime.",
      target: "h5",
      evidence: {
        url: target.url
      }
    });
    return {
      valid: false,
      target,
      checkedAt,
      blockers,
      setupBlockers
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), target.timeoutMs ?? 3000);
    const response = await fetch(target.url, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      blockers.push(`url responded with HTTP ${response.status}`);
    }
    if (!response.ok) {
      setupBlockers.push({
        code: "port_unreachable",
        severity: "error",
        message: `H5 URL responded with HTTP ${response.status}.`,
        remediation: "Start the dev server or pass the correct H5 URL.",
        target: "h5",
        evidence: {
          url: target.url,
          status: response.status
        }
      });
    }

    return {
      valid: response.ok,
      target,
      checkedAt,
      reachable: true,
      status: response.status,
      blockers,
      setupBlockers
    };
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
    setupBlockers.push({
      code: "port_unreachable",
      severity: "error",
      message: `Peekit could not reach ${target.url}.`,
      remediation: "Start the dev server, check the port, or pass the correct loopback URL.",
      target: "h5",
      evidence: {
        url: target.url,
        reason: error instanceof Error ? error.message : String(error)
      }
    });
    return {
      valid: false,
      target,
      checkedAt,
      reachable: false,
      blockers,
      setupBlockers
    };
  }
}

export function explainSetupBlocker(validation: TargetValidationResult): string {
  if (validation.valid) {
    return "Target is reachable and can be connected by Peekit.";
  }

  if (validation.blockers.length === 0) {
    return "Target is not valid, but no specific blocker was reported.";
  }

  if (validation.setupBlockers && validation.setupBlockers.length > 0) {
    return validation.setupBlockers
      .map((blocker) => `${blocker.message} ${blocker.remediation}`)
      .join(" ");
  }

  return `Peekit cannot connect yet: ${validation.blockers.join("; ")}.`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

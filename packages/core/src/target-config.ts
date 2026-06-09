import type {
  EnvironmentInspection,
  PeekitTargetConfig,
  TargetKind,
  TargetValidationResult
} from "./types.js";

export function suggestTargetConfigs(
  environment: EnvironmentInspection,
  preferredKind?: TargetKind
): PeekitTargetConfig[] {
  const suggestions: PeekitTargetConfig[] = [];

  if (!preferredKind || preferredKind === "h5") {
    for (const hint of environment.devServerHints) {
      suggestions.push({
        id: `h5:${hint.likelyUrl ?? hint.script}`,
        name: `H5 (${hint.script})`,
        type: "h5",
        url: hint.likelyUrl,
        rootDir: environment.cwd,
        browser: "chromium",
        headless: true,
        metadata: {
          script: hint.script,
          command: hint.command
        }
      });
    }
  }

  for (const hint of environment.miniProgramHints) {
    if (preferredKind && preferredKind !== hint.platform) {
      continue;
    }
    suggestions.push({
      id: `${hint.platform}:${hint.file}`,
      name: `${hint.platform} (${hint.file})`,
      type: hint.platform,
      rootDir: environment.cwd,
      ...(hint.platform === "mp-weixin" ? { projectPath: environment.cwd } : {}),
      metadata: {
        configFile: hint.file
      }
    });
  }

  return suggestions;
}

export async function validateTargetConfig(
  target: PeekitTargetConfig
): Promise<TargetValidationResult> {
  const blockers: string[] = [];
  const checkedAt = new Date().toISOString();

  if (target.type === "mp-weixin") {
    if (!target.projectPath && !target.rootDir && !target.wsEndpoint) {
      blockers.push("mp-weixin target needs projectPath, rootDir, or wsEndpoint");
    }
    return {
      valid: blockers.length === 0,
      target,
      checkedAt,
      blockers
    };
  }

  if (target.type !== "h5") {
    blockers.push(`${target.type} adapter is planned but not implemented yet`);
    return {
      valid: false,
      target,
      checkedAt,
      blockers
    };
  }

  if (!target.url && !target.connectOverCDP) {
    blockers.push("h5 target needs url or connectOverCDP");
    return {
      valid: false,
      target,
      checkedAt,
      blockers
    };
  }

  if (!target.url) {
    return {
      valid: true,
      target,
      checkedAt,
      blockers
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

    return {
      valid: response.ok,
      target,
      checkedAt,
      reachable: true,
      status: response.status,
      blockers
    };
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
    return {
      valid: false,
      target,
      checkedAt,
      reachable: false,
      blockers
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

  return `Peekit cannot connect yet: ${validation.blockers.join("; ")}.`;
}

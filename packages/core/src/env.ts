import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EnvironmentInspection, TargetKind } from "./types.js";

type PackageJsonShape = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

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

  if (!packageJson) {
    blockers.push("package.json was not found");
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
    blockers
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

async function detectPackageManager(
  root: string
): Promise<EnvironmentInspection["packageManager"]> {
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

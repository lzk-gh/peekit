import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectProjectEnvironment } from "./env.js";
import { suggestTargetConfigs, validateTargetConfig } from "./target-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AI setup assistant discovery", () => {
  it("uses safe local discovery for toolchain, loopback ports, and MCP client paths", async () => {
    const port = await getFreePort();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
    });
    await listen(server, port);

    try {
      const root = await tempDir();
      const home = await tempDir();
      const appData = await tempDir();
      const claudeConfig = join(appData, "Claude", "claude_desktop_config.json");
      await mkdir(join(appData, "Claude"), { recursive: true });
      await writeFile(claudeConfig, '{"secret":"DO_NOT_READ"}', "utf8");
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "setup-fixture",
          scripts: {
            dev: `vite --host 127.0.0.1 --port ${port}`
          },
          devDependencies: {
            vite: "latest"
          }
        }),
        "utf8"
      );
      await writeFile(join(root, "pnpm-lock.yaml"), "", "utf8");

      const environment = await withEnv(
        {
          APPDATA: appData,
          USERPROFILE: home,
          HOME: home
        },
        () => inspectProjectEnvironment(root)
      );

      expect(environment.packageManager).toBe("pnpm");
      expect(environment.toolchain.system.platform).toBe(process.platform);
      expect(environment.toolchain.node.version).toBe(process.version);
      expect(environment.toolchain.packageManagers.map((item) => item.name)).toEqual([
        "pnpm",
        "npm",
        "yarn",
        "bun"
      ]);
      expect(environment.ports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: `http://localhost:${port}`,
            reachable: true,
            status: 200,
            source: "dev"
          })
        ])
      );
      expect(environment.mcpClients).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Claude Desktop",
            configPath: claudeConfig,
            exists: true,
            contentRead: false
          })
        ])
      );
      expect(JSON.stringify(environment)).not.toContain("DO_NOT_READ");
      expect(environment.security.policy).toBe("safe-local-discovery");
      expect(environment.security.skipped).toEqual(
        expect.arrayContaining([
          "full disk scans",
          "SSH keys, tokens, and browser profiles",
          "MCP client/editor config file contents"
        ])
      );
    } finally {
      await close(server);
    }
  });

  it("prefers user-provided local setup manifest before fallback discovery", async () => {
    const manifestPort = await getFreePort();
    const fallbackPort = await getFreePort();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
    });
    await listen(server, manifestPort);

    try {
      const root = await tempDir();
      const browserPath = join(root, "chrome.exe");
      const cliPath = join(root, "wechat-cli.bat");
      const appPath = join(root, "Cursor.exe");
      const clientConfig = join(root, "cursor-mcp.json");

      await mkdir(join(root, ".peekit"), { recursive: true });
      await writeFile(browserPath, "", "utf8");
      await writeFile(cliPath, "", "utf8");
      await writeFile(appPath, "", "utf8");
      await writeFile(clientConfig, '{"token":"DO_NOT_READ"}', "utf8");
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "manifest-first",
          scripts: {
            dev: `vite --port ${fallbackPort}`
          },
          devDependencies: {
            vite: "latest"
          }
        }),
        "utf8"
      );
      await writeFile(
        join(root, ".peekit", "local-setup.json"),
        JSON.stringify({
          version: 1,
          h5: {
            url: `http://localhost:${manifestPort}`,
            browserPath
          },
          weixin: {
            cliPath,
            projectPath: root
          },
          mcpClients: [
            {
              name: "Cursor",
              configPath: clientConfig,
              appPath
            }
          ],
          editorApps: [
            {
              name: "Cursor",
              appPath
            }
          ]
        }),
        "utf8"
      );

      const environment = await inspectProjectEnvironment(root);

      expect(environment.setupManifest).toMatchObject({
        exists: true,
        valid: true,
        contentRead: true
      });
      expect(environment.ports.map((port) => port.url)).toEqual([
        `http://localhost:${manifestPort}`
      ]);
      expect(environment.toolchain.browsers[0]).toMatchObject({
        path: browserPath,
        available: true,
        source: "manifest"
      });
      expect(environment.toolchain.miniProgramDevTools[0]).toMatchObject({
        cliPath,
        available: true,
        source: "manifest"
      });
      expect(environment.mcpClients).toEqual([
        expect.objectContaining({
          name: "Cursor",
          configPath: clientConfig,
          exists: true,
          contentRead: false,
          source: "manifest",
          appPath,
          appExists: true
        })
      ]);
      expect(environment.editorApps).toEqual([
        expect.objectContaining({
          name: "Cursor",
          appPath,
          exists: true,
          source: "manifest"
        })
      ]);
      expect(JSON.stringify(environment)).not.toContain("DO_NOT_READ");

      expect(suggestTargetConfigs(environment, "h5")[0]).toMatchObject({
        type: "h5",
        url: `http://localhost:${manifestPort}`,
        browserPath,
        metadata: {
          source: "manifest",
          confidence: "high",
          requiresUserAction: false
        }
      });
      expect(suggestTargetConfigs(environment, "mp-weixin")[0]).toMatchObject({
        type: "mp-weixin",
        projectPath: root,
        cliPath,
        metadata: {
          source: "manifest",
          confidence: "high",
          requiresUserAction: false
        }
      });
    } finally {
      await close(server);
    }
  });

  it("reports unreachable inferred dev server ports as setup blockers", async () => {
    const port = await getFreePort();
    const root = await tempDir();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "unreachable-port",
        scripts: {
          dev: `vite --port ${port}`
        },
        devDependencies: {
          vite: "latest"
        }
      }),
      "utf8"
    );

    const environment = await inspectProjectEnvironment(root);

    expect(environment.ports[0]).toMatchObject({
      url: `http://localhost:${port}`,
      reachable: false
    });
    expect(environment.setupBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "port_unreachable",
          target: "h5"
        })
      ])
    );
  });

  it("reports malformed local setup manifests without stopping fallback discovery", async () => {
    const root = await tempDir();
    await mkdir(join(root, ".peekit"), { recursive: true });
    await writeFile(join(root, ".peekit", "local-setup.json"), "{", "utf8");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "malformed-manifest",
        scripts: {
          dev: "vite --port 5199"
        },
        devDependencies: {
          vite: "latest"
        }
      }),
      "utf8"
    );

    const environment = await inspectProjectEnvironment(root);

    expect(environment.setupManifest).toMatchObject({
      exists: true,
      valid: false,
      contentRead: true
    });
    expect(environment.ports[0]?.url).toBe("http://localhost:5199");
    expect(environment.setupBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_setup_manifest"
        })
      ])
    );
  });

  it("suggests target configs with confidence metadata and discovered Weixin CLI", async () => {
    const root = await tempDir();
    const cliPath = join(root, "wechat-cli.bat");
    await writeFile(cliPath, "", "utf8");
    await writeFile(join(root, "project.config.json"), "{}", "utf8");

    const environment = await withEnv({ WECHAT_DEVTOOLS_CLI: cliPath }, () =>
      inspectProjectEnvironment(root)
    );
    const suggestions = suggestTargetConfigs(environment, "mp-weixin");

    expect(suggestions[0]).toMatchObject({
      type: "mp-weixin",
      projectPath: root,
      cliPath,
      metadata: {
        source: "project-config",
        confidence: "high",
        requiresUserAction: false
      }
    });
  });

  it("validates setup blockers without probing non-loopback addresses", async () => {
    await expect(
      validateTargetConfig({
        type: "h5"
      })
    ).resolves.toMatchObject({
      valid: false,
      setupBlockers: [expect.objectContaining({ code: "invalid_target" })]
    });

    await expect(
      validateTargetConfig({
        type: "h5",
        url: "not-a-url"
      })
    ).resolves.toMatchObject({
      valid: false,
      setupBlockers: [expect.objectContaining({ code: "invalid_target" })]
    });

    await expect(
      validateTargetConfig({
        type: "h5",
        url: "http://localhost:1",
        browserPath: join(await tempDir(), "missing-browser.exe")
      })
    ).resolves.toMatchObject({
      valid: false,
      setupBlockers: [expect.objectContaining({ code: "missing_tool" })]
    });

    await expect(
      validateTargetConfig({
        type: "h5",
        url: "https://example.com"
      })
    ).resolves.toMatchObject({
      valid: false,
      setupBlockers: [expect.objectContaining({ code: "permission_required" })]
    });

    await expect(
      validateTargetConfig({
        type: "mp-weixin",
        projectPath: "demo"
      })
    ).resolves.toMatchObject({
      valid: false,
      setupBlockers: [expect.objectContaining({ code: "missing_tool" })]
    });
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "peekit-setup-"));
  tempDirs.push(dir);
  return dir;
}

async function getFreePort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await close(server);

  if (!address || typeof address === "string") {
    throw new Error("Unable to allocate port");
  }

  return address.port;
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  await new Promise<void>((resolveListen) => {
    server.listen(port, "127.0.0.1", resolveListen);
  });
}

async function close(server: { close: (callback: (error?: Error) => void) => void }): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error?: Error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

async function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  ) as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

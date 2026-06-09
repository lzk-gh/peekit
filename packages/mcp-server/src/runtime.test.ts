import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PeekitMcpRuntime } from "./runtime.js";

describe("PeekitMcpRuntime", () => {
  it("lists the implemented H5 capability matrix", async () => {
    const runtime = new PeekitMcpRuntime([]);

    const result = (await runtime.callTool("peekit_list_targets", {})) as {
      capabilityMatrix: Record<string, { status: string }>;
    };

    expect(result.capabilityMatrix.h5.status).toBe("implemented");
    expect(result.capabilityMatrix["mp-weixin"].status).toBe("implemented");
  });

  it("connects planned non-Weixin adapters as explicit unsupported sessions", async () => {
    const runtime = new PeekitMcpRuntime();

    const result = (await runtime.callTool("peekit_connect_target", {
      type: "mp-alipay",
      id: "alipay:test"
    })) as {
      evidence: { unsupported?: Array<{ field: string }> };
    };

    expect(result.evidence.unsupported?.[0]?.field).toBe("page");
  });

  it("persists recorded cases for replay across runtime instances", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "peekit-cases-"));
    const caseStorePath = resolve(tempDir, "cases.json");

    try {
      const firstRuntime = new PeekitMcpRuntime(undefined, { caseStorePath });
      await firstRuntime.callTool("peekit_connect_target", {
        type: "mp-alipay",
        id: "mp:persist"
      });
      const recorded = (await firstRuntime.callTool("peekit_record_case", {
        name: "persistent case",
        steps: [{ action: "tap", selector: ".submit" }],
        snapshotIds: ["before", "after"],
        notes: "stored on disk"
      })) as { id: string; targetId?: string };

      expect(recorded.id).toMatch(/^case:/);
      expect(recorded.targetId).toBe("mp:persist");

      const raw = JSON.parse(await readFile(caseStorePath, "utf8")) as {
        version: number;
        cases: Array<{ id: string; name: string }>;
      };
      expect(raw.version).toBe(1);
      expect(raw.cases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: recorded.id,
            name: "persistent case"
          })
        ])
      );

      const secondRuntime = new PeekitMcpRuntime(undefined, { caseStorePath });
      await secondRuntime.callTool("peekit_connect_target", {
        type: "mp-alipay",
        id: "mp:persist"
      });
      const replay = (await secondRuntime.callTool("peekit_replay_case", {
        name: "persistent case"
      })) as {
        replayed: boolean;
        results: Array<{ interaction?: { action: string }; unsupported?: Array<{ field: string }> }>;
      };

      expect(replay.replayed).toBe(true);
      expect(replay.results[0]?.interaction?.action).toBe("tap");
      expect(replay.results[0]?.unsupported?.[0]?.field).toBe("interaction");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

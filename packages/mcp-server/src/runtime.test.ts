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
});

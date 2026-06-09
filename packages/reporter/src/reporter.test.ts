import { describe, expect, it } from "vitest";
import { summarizeEvidence, toAgentJson } from "./index.js";

describe("reporter", () => {
  it("renders stable agent JSON", () => {
    expect(toAgentJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("summarizes evidence without hiding unsupported fields", () => {
    const summary = summarizeEvidence({
      target: "mp-weixin:demo",
      targetType: "mp-weixin",
      capabilityLevel: 0,
      page: {},
      console: [],
      errors: [],
      unsupported: [{ field: "element", reason: "planned adapter" }]
    });

    expect(summary).toContain("unsupported");
    expect(summary).toContain("planned adapter");
  });
});

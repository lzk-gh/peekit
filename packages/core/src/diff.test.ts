import { describe, expect, it } from "vitest";
import { diffSnapshots } from "./diff.js";
import type { RuntimeSnapshot } from "./types.js";

describe("diffSnapshots", () => {
  it("reports measured page and element changes", () => {
    const before = snapshot("before", "Submit", "button");
    const after = snapshot("after", "Loading", "button loading");

    const diff = diffSnapshots(before, after);

    expect(diff.changed).toBe(true);
    expect(diff.summary).toContain("element changed: #submit (text, className)");
  });

  it("reports no measured changes for identical snapshots", () => {
    const before = snapshot("same", "Submit", "button");
    const after = snapshot("same-after", "Submit", "button");

    const diff = diffSnapshots(before, after);

    expect(diff.changed).toBe(false);
    expect(diff.summary).toEqual(["no measured runtime changes"]);
  });
});

function snapshot(id: string, text: string, className: string): RuntimeSnapshot {
  return {
    kind: "snapshot",
    snapshotId: id,
    capturedAt: "2026-01-01T00:00:00.000Z",
    target: "h5:test",
    targetType: "h5",
    capabilityLevel: 4,
    page: {
      url: "http://localhost:5173",
      title: "Test"
    },
    elements: [
      {
        selector: "#submit",
        tag: "button",
        text,
        className
      }
    ],
    console: [],
    errors: []
  };
}

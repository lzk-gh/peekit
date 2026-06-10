import { describe, expect, it } from "vitest";
import { compareCrossTargetSnapshots, diffSnapshots } from "./diff.js";
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

  it("summarizes cross-target page, element, console, and error differences", () => {
    const h5 = snapshot("h5", "Submit", "button");
    const weixin = snapshot("weixin", "提交", "button primary");
    h5.target = "h5:demo";
    h5.targetType = "h5";
    weixin.target = "mp-weixin:demo";
    weixin.targetType = "mp-weixin";
    const h5Button = h5.elements[0];
    const weixinButton = weixin.elements[0];
    if (!h5Button || !weixinButton) {
      throw new Error("snapshot fixture is missing the submit button");
    }
    h5.elements[0] = {
      ...h5Button,
      attributes: { "data-testid": "submit-button" },
      rect: { left: 16, top: 24, width: 120, height: 40 },
      styles: { color: "rgb(255, 255, 255)" },
      state: { visible: true }
    };
    weixin.elements[0] = {
      ...weixinButton,
      selector: ".submit",
      attributes: { "data-testid": "submit-button" },
      rect: { left: 20, top: 28, width: 132, height: 44 },
      styles: { color: "#ffffff" },
      state: { visible: true }
    };
    weixin.elements.push({
      selector: "#toast",
      tag: "view",
      text: "Saved",
      attributes: { id: "toast" }
    });
    h5.console = [{ type: "info", text: "h5 ready" }];
    weixin.console = [{ type: "info", text: "weixin ready" }];
    weixin.errors = [{ source: "mp-weixin", message: "style warning" }];

    const comparison = compareCrossTargetSnapshots(h5, weixin);

    expect(comparison).toMatchObject({
      leftTarget: "h5:demo",
      rightTarget: "mp-weixin:demo",
      leftTargetType: "h5",
      rightTargetType: "mp-weixin",
      changed: true,
      leftSnapshotId: "h5",
      rightSnapshotId: "weixin"
    });
    expect(comparison.elementComparisons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "data-testid:submit-button",
          status: "matched",
          leftSelector: "#submit",
          rightSelector: ".submit",
          riskFields: expect.arrayContaining(["content", "class", "layout", "style"])
        }),
        expect.objectContaining({
          key: "id:toast",
          status: "right-only",
          severity: "error",
          riskFields: ["presence"]
        })
      ])
    );
    expect(comparison.consoleChanges.leftOnly).toEqual([{ type: "info", text: "h5 ready" }]);
    expect(comparison.consoleChanges.rightOnly).toEqual([
      { type: "info", text: "weixin ready" }
    ]);
    expect(comparison.errorChanges.rightOnly).toEqual([
      { source: "mp-weixin", message: "style warning" }
    ]);
    expect(comparison.summary).toEqual(
      expect.arrayContaining([
        expect.stringContaining("h5:demo (h5) vs mp-weixin:demo (mp-weixin)"),
        expect.stringContaining("elements missing on one target")
      ])
    );
    expect(comparison.nextProbes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stable id or data-testid"),
        expect.stringContaining("layout and style")
      ])
    );
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

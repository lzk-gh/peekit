import { describe, expect, it } from "vitest";
import { diagnoseIssue } from "./diagnostics.js";

describe("diagnoseIssue", () => {
  it("suggests state and tap probes when interaction produced no change", () => {
    const diagnosis = diagnoseIssue({
      problem: "tap did not trigger loading state",
      evidence: [
        {
          target: "h5:test",
          targetType: "h5",
          capabilityLevel: 4,
          page: {},
          element: {
            selector: ".submit",
            tag: "button",
            text: "Submit"
          },
          interaction: {
            action: "tap"
          },
          console: [],
          errors: []
        }
      ]
    });

    expect(diagnosis.likelyCauses).toContain(
      "interaction did not produce a measurable DOM or style change"
    );
    expect(diagnosis.nextProbes).toContain(
      "capture the target element and parent component state before and after interaction"
    );
  });
});

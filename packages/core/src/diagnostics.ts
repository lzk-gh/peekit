import { diffSnapshots } from "./diff.js";
import type { Diagnosis, RuntimeEvidence, RuntimeSnapshot, SnapshotDiff } from "./types.js";

export type DiagnoseIssueInput = {
  problem?: string;
  evidence?: RuntimeEvidence[];
  before?: RuntimeSnapshot;
  after?: RuntimeSnapshot;
  diff?: SnapshotDiff;
};

export function diagnoseIssue(input: DiagnoseIssueInput): Diagnosis {
  const diff =
    input.diff ?? (input.before && input.after ? diffSnapshots(input.before, input.after) : undefined);
  const evidence = collectEvidence(input.evidence ?? [], diff);
  const likelyCauses = new Set<string>();
  const nextProbes = new Set<string>();

  const problem = input.problem?.toLowerCase() ?? "";
  const hasInteraction = (input.evidence ?? []).some((item) => item.interaction);
  const errors = [
    ...(input.evidence ?? []).flatMap((item) => item.errors),
    ...(input.after?.errors ?? [])
  ];

  if (errors.length > 0) {
    likelyCauses.add("runtime error is affecting the page behavior");
    nextProbes.add("inspect the first runtime error stack and the component that emitted it");
  }

  if (problem.includes("loading") || problem.includes("state")) {
    if (!diff || !diff.changed) {
      likelyCauses.add("interaction did not produce a measurable DOM or style change");
      likelyCauses.add("state changed in application memory but was not bound to visible UI");
      nextProbes.add("capture the target element and parent component state before and after interaction");
    }
  }

  if (problem.includes("click") || problem.includes("tap") || hasInteraction) {
    likelyCauses.add("selected element may not be the actual interactive target");
    nextProbes.add("query the tapped element, its nearest button role, and its parent container");
  }

  if (diff?.elementChanges.some((change) => change.changes.some((item) => item.field.startsWith("styles")))) {
    likelyCauses.add("computed styles changed after interaction");
    nextProbes.add("compare the exact computed style fields that changed");
  }

  if (diff?.elementChanges.every((change) => change.status === "unchanged") && hasInteraction) {
    likelyCauses.add("event handler did not fire or exited before updating visible state");
    nextProbes.add("capture console output and network errors immediately after the interaction");
  }

  if (likelyCauses.size === 0) {
    likelyCauses.add("evidence is insufficient to isolate one cause");
  }

  if (nextProbes.size === 0) {
    nextProbes.add("capture a focused before and after snapshot around the relevant selector");
  }

  return {
    problem: input.problem,
    evidence,
    likelyCauses: [...likelyCauses],
    nextProbes: [...nextProbes]
  };
}

export function suggestNextProbe(input: DiagnoseIssueInput): string[] {
  return diagnoseIssue(input).nextProbes;
}

function collectEvidence(evidence: RuntimeEvidence[], diff?: SnapshotDiff): string[] {
  const lines: string[] = [];

  for (const item of evidence) {
    if (item.element) {
      lines.push(
        `${item.element.selector}: tag=${item.element.tag ?? "unknown"}, text=${JSON.stringify(
          item.element.text ?? ""
        )}, className=${JSON.stringify(item.element.className ?? "")}`
      );
    }

    if (item.interaction) {
      lines.push(`interaction: ${item.interaction.action}`);
    }

    if (item.console.length > 0) {
      lines.push(`console entries: ${item.console.length}`);
    }

    if (item.errors.length > 0) {
      lines.push(`runtime errors: ${item.errors.map((error) => error.message).join("; ")}`);
    }

    if (item.unsupported && item.unsupported.length > 0) {
      lines.push(
        `unsupported: ${item.unsupported.map((entry) => `${entry.field} (${entry.reason})`).join("; ")}`
      );
    }
  }

  if (diff) {
    lines.push(...diff.summary);
  }

  if (lines.length === 0) {
    lines.push("no runtime evidence supplied");
  }

  return lines;
}

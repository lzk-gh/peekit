import type { Diagnosis, RuntimeEvidence, RuntimeSnapshot, SnapshotDiff } from "@peekit/core";

export function toAgentJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function summarizeEvidence(evidence: RuntimeEvidence): string {
  const lines = [
    `# Peekit Evidence`,
    ``,
    `- target: ${evidence.target}`,
    `- capabilityLevel: ${evidence.capabilityLevel}`
  ];

  if (evidence.page.url) {
    lines.push(`- url: ${evidence.page.url}`);
  }

  if (evidence.page.route) {
    lines.push(`- route: ${evidence.page.route}`);
  }

  if (evidence.element) {
    lines.push(
      `- element: ${evidence.element.selector}`,
      `- tag: ${evidence.element.tag ?? "unknown"}`,
      `- text: ${formatInline(evidence.element.text ?? "")}`,
      `- className: ${formatInline(evidence.element.className ?? "")}`
    );

    if (evidence.element.rect) {
      lines.push(`- rect: ${JSON.stringify(evidence.element.rect)}`);
    }
  }

  if (evidence.interaction) {
    lines.push(`- interaction: ${evidence.interaction.action}`);
  }

  if (evidence.console.length > 0) {
    lines.push(`- console: ${evidence.console.length} entries`);
  }

  if (evidence.errors.length > 0) {
    lines.push(`- errors: ${evidence.errors.map((error) => error.message).join("; ")}`);
  }

  if (evidence.unsupported && evidence.unsupported.length > 0) {
    lines.push(
      `- unsupported: ${evidence.unsupported
        .map((entry) => `${entry.field} (${entry.reason})`)
        .join("; ")}`
    );
  }

  return lines.join("\n");
}

export function summarizeSnapshot(snapshot: RuntimeSnapshot): string {
  const lines = [
    `# Peekit Snapshot`,
    ``,
    `- snapshotId: ${snapshot.snapshotId ?? "none"}`,
    `- target: ${snapshot.target}`,
    `- capturedAt: ${snapshot.capturedAt}`,
    `- elements: ${snapshot.elements.length}`,
    `- console: ${snapshot.console.length}`,
    `- errors: ${snapshot.errors.length}`
  ];

  for (const element of snapshot.elements.slice(0, 8)) {
    lines.push(
      `- ${element.selector}: ${element.tag ?? "unknown"} ${formatInline(
        element.text ?? ""
      )} ${formatInline(element.className ?? "")}`
    );
  }

  if (snapshot.elements.length > 8) {
    lines.push(`- ... ${snapshot.elements.length - 8} more elements`);
  }

  return lines.join("\n");
}

export function summarizeDiff(diff: SnapshotDiff): string {
  return [`# Peekit Snapshot Diff`, ``, ...diff.summary.map((line) => `- ${line}`)].join("\n");
}

export function summarizeDiagnosis(diagnosis: Diagnosis): string {
  const lines = [`# Peekit Diagnosis`, ``];

  if (diagnosis.problem) {
    lines.push(`Problem: ${diagnosis.problem}`, ``);
  }

  lines.push(`Evidence:`, ...diagnosis.evidence.map((line) => `- ${line}`), ``);
  lines.push(`Likely causes:`, ...diagnosis.likelyCauses.map((line) => `- ${line}`), ``);
  lines.push(`Next probes:`, ...diagnosis.nextProbes.map((line) => `- ${line}`));

  return lines.join("\n");
}

function formatInline(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return JSON.stringify(compact.length > 80 ? `${compact.slice(0, 77)}...` : compact);
}

import type {
  ConsoleEntry,
  CrossTargetComparison,
  CrossTargetElementComparison,
  ElementChange,
  ElementEvidence,
  FieldChange,
  RuntimeError,
  RuntimeSnapshot,
  SnapshotDiff
} from "./types.js";

export function diffSnapshots(before: RuntimeSnapshot, after: RuntimeSnapshot): SnapshotDiff {
  const pageChanges = diffObject("page", before.page, after.page);
  const elementChanges = diffElements(before.elements, after.elements);
  const consoleChanges = diffArray(before.console, after.console, stableStringify);
  const errorChanges = diffArray(before.errors, after.errors, stableStringify);

  const changed =
    pageChanges.length > 0 ||
    elementChanges.some((change) => change.status !== "unchanged") ||
    consoleChanges.added.length > 0 ||
    consoleChanges.removed.length > 0 ||
    errorChanges.added.length > 0 ||
    errorChanges.removed.length > 0;

  return {
    beforeId: before.snapshotId,
    afterId: after.snapshotId,
    changed,
    pageChanges,
    elementChanges,
    consoleChanges,
    errorChanges,
    summary: buildSummary(pageChanges, elementChanges, consoleChanges, errorChanges)
  };
}

export function compareCrossTargetSnapshots(
  left: RuntimeSnapshot,
  right: RuntimeSnapshot
): CrossTargetComparison {
  const diff = diffSnapshots(left, right);
  const pageChanges = diffObject("page", left.page, right.page);
  const elementComparisons = compareCrossTargetElements(left.elements, right.elements);
  const consoleChanges = diffArray(left.console, right.console, stableStringify);
  const errorChanges = diffArray(left.errors, right.errors, stableStringify);
  const changed =
    pageChanges.length > 0 ||
    elementComparisons.some((comparison) => comparison.status !== "matched" || comparison.differences.length > 0) ||
    consoleChanges.added.length > 0 ||
    consoleChanges.removed.length > 0 ||
    errorChanges.added.length > 0 ||
    errorChanges.removed.length > 0;

  const comparison: CrossTargetComparison = {
    leftTarget: left.target,
    rightTarget: right.target,
    ...(left.targetType ? { leftTargetType: left.targetType } : {}),
    ...(right.targetType ? { rightTargetType: right.targetType } : {}),
    ...(left.snapshotId ? { leftSnapshotId: left.snapshotId } : {}),
    ...(right.snapshotId ? { rightSnapshotId: right.snapshotId } : {}),
    changed,
    diff,
    pageChanges,
    elementComparisons,
    consoleChanges: {
      leftOnly: consoleChanges.removed,
      rightOnly: consoleChanges.added
    },
    errorChanges: {
      leftOnly: errorChanges.removed,
      rightOnly: errorChanges.added
    },
    summary: [],
    nextProbes: []
  };

  comparison.summary = buildCrossTargetSummary(comparison);
  comparison.nextProbes = buildCrossTargetNextProbes(comparison);
  return comparison;
}

function diffElements(before: ElementEvidence[], after: ElementEvidence[]): ElementChange[] {
  const beforeMap = indexElements(before);
  const afterMap = indexElements(after);
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: ElementChange[] = [];

  for (const key of keys) {
    const beforeElement = beforeMap.get(key);
    const afterElement = afterMap.get(key);

    if (!beforeElement && afterElement) {
      changes.push({
        selector: key,
        status: "added",
        changes: [{ field: "element", after: compactElement(afterElement) }]
      });
      continue;
    }

    if (beforeElement && !afterElement) {
      changes.push({
        selector: key,
        status: "removed",
        changes: [{ field: "element", before: compactElement(beforeElement) }]
      });
      continue;
    }

    if (beforeElement && afterElement) {
      const fieldChanges = [
        ...diffPrimitive("tag", beforeElement.tag, afterElement.tag),
        ...diffPrimitive("text", beforeElement.text, afterElement.text),
        ...diffPrimitive("className", beforeElement.className, afterElement.className),
        ...diffObject("attributes", beforeElement.attributes, afterElement.attributes),
        ...diffObject("rect", beforeElement.rect, afterElement.rect),
        ...diffObject("styles", beforeElement.styles, afterElement.styles),
        ...diffObject("state", beforeElement.state, afterElement.state)
      ];

      changes.push({
        selector: key,
        status: fieldChanges.length > 0 ? "changed" : "unchanged",
        changes: fieldChanges
      });
    }
  }

  return changes;
}

function compareCrossTargetElements(
  left: ElementEvidence[],
  right: ElementEvidence[]
): CrossTargetElementComparison[] {
  const leftMap = indexElementsForCrossTarget(left);
  const rightMap = indexElementsForCrossTarget(right);
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const comparisons: CrossTargetElementComparison[] = [];

  for (const key of keys) {
    const leftElement = leftMap.get(key);
    const rightElement = rightMap.get(key);

    if (!leftElement && rightElement) {
      comparisons.push({
        key,
        status: "right-only",
        rightSelector: rightElement.selector,
        right: compactElement(rightElement),
        differences: [{ field: "element", after: compactElement(rightElement) }],
        riskFields: ["presence"],
        severity: "error",
        summary: [`${key} exists only on right target (${rightElement.selector})`]
      });
      continue;
    }

    if (leftElement && !rightElement) {
      comparisons.push({
        key,
        status: "left-only",
        leftSelector: leftElement.selector,
        left: compactElement(leftElement),
        differences: [{ field: "element", before: compactElement(leftElement) }],
        riskFields: ["presence"],
        severity: "error",
        summary: [`${key} exists only on left target (${leftElement.selector})`]
      });
      continue;
    }

    if (leftElement && rightElement) {
      const differences = [
        ...diffPrimitive("tag", leftElement.tag, rightElement.tag),
        ...diffPrimitive("text", leftElement.text, rightElement.text),
        ...diffPrimitive("className", leftElement.className, rightElement.className),
        ...diffObject("attributes", leftElement.attributes, rightElement.attributes),
        ...diffObject("rect", leftElement.rect, rightElement.rect),
        ...diffObject("styles", leftElement.styles, rightElement.styles),
        ...diffObject("state", leftElement.state, rightElement.state)
      ];
      const riskFields = summarizeRiskFields(differences);

      comparisons.push({
        key,
        status: "matched",
        leftSelector: leftElement.selector,
        rightSelector: rightElement.selector,
        left: compactElement(leftElement),
        right: compactElement(rightElement),
        differences,
        riskFields,
        severity: differences.length > 0 ? "warning" : "info",
        summary:
          differences.length > 0
            ? [`${key} differs in ${riskFields.join(", ")}`]
            : [`${key} matched with no measured differences`]
      });
    }
  }

  return comparisons;
}

function diffPrimitive(field: string, before: unknown, after: unknown): FieldChange[] {
  if (stableStringify(before) === stableStringify(after)) {
    return [];
  }

  return [{ field, before, after }];
}

function diffObject(fieldPrefix: string, before: unknown, after: unknown): FieldChange[] {
  if (stableStringify(before) === stableStringify(after)) {
    return [];
  }

  if (!isRecord(before) || !isRecord(after)) {
    return [{ field: fieldPrefix, before, after }];
  }

  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const beforeValue = before[key];
    const afterValue = after[key];
    if (stableStringify(beforeValue) !== stableStringify(afterValue)) {
      changes.push({
        field: `${fieldPrefix}.${key}`,
        before: beforeValue,
        after: afterValue
      });
    }
  }

  return changes;
}

function diffArray<T>(
  before: T[],
  after: T[],
  keyFn: (item: T) => string
): { added: T[]; removed: T[] } {
  const beforeKeys = new Set(before.map(keyFn));
  const afterKeys = new Set(after.map(keyFn));

  return {
    added: after.filter((item) => !beforeKeys.has(keyFn(item))),
    removed: before.filter((item) => !afterKeys.has(keyFn(item)))
  };
}

function buildSummary(
  pageChanges: FieldChange[],
  elementChanges: ElementChange[],
  consoleChanges: { added: ConsoleEntry[]; removed: ConsoleEntry[] },
  errorChanges: { added: RuntimeError[]; removed: RuntimeError[] }
): string[] {
  const summary: string[] = [];

  for (const change of pageChanges) {
    summary.push(`${change.field}: ${format(change.before)} -> ${format(change.after)}`);
  }

  for (const elementChange of elementChanges) {
    if (elementChange.status === "added") {
      summary.push(`element added: ${elementChange.selector}`);
    } else if (elementChange.status === "removed") {
      summary.push(`element removed: ${elementChange.selector}`);
    } else if (elementChange.status === "changed") {
      const fields = elementChange.changes.map((change) => change.field).join(", ");
      summary.push(`element changed: ${elementChange.selector} (${fields})`);
    }
  }

  if (consoleChanges.added.length > 0) {
    summary.push(`console added: ${consoleChanges.added.length}`);
  }

  if (consoleChanges.removed.length > 0) {
    summary.push(`console removed: ${consoleChanges.removed.length}`);
  }

  if (errorChanges.added.length > 0) {
    summary.push(`errors added: ${errorChanges.added.length}`);
  }

  if (errorChanges.removed.length > 0) {
    summary.push(`errors removed: ${errorChanges.removed.length}`);
  }

  if (summary.length === 0) {
    summary.push("no measured runtime changes");
  }

  return summary;
}

function indexElements(elements: ElementEvidence[]): Map<string, ElementEvidence> {
  const counts = new Map<string, number>();
  const map = new Map<string, ElementEvidence>();

  for (const element of elements) {
    const base = element.selector;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    map.set(count === 0 ? base : `${base}#${count}`, element);
  }

  return map;
}

function indexElementsForCrossTarget(elements: ElementEvidence[]): Map<string, ElementEvidence> {
  const counts = new Map<string, number>();
  const map = new Map<string, ElementEvidence>();

  for (const element of elements) {
    const base = crossTargetElementKey(element);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    map.set(count === 0 ? base : `${base}#${count}`, element);
  }

  return map;
}

function crossTargetElementKey(element: ElementEvidence): string {
  const testId = element.attributes?.["data-testid"];
  if (testId) {
    return `data-testid:${testId}`;
  }

  const id = element.attributes?.id ?? idFromSelector(element.selector);
  if (id) {
    return `id:${id}`;
  }

  return `selector:${element.selector}`;
}

function idFromSelector(selector: string): string | undefined {
  const match = selector.match(/^#([A-Za-z0-9_-]+)$/);
  return match?.[1];
}

function compactElement(element: ElementEvidence): ElementEvidence {
  return {
    selector: element.selector,
    tag: element.tag,
    text: element.text,
    className: element.className,
    rect: element.rect,
    styles: element.styles,
    state: element.state
  };
}

function summarizeRiskFields(changes: FieldChange[]): string[] {
  const fields = new Set<string>();

  for (const change of changes) {
    if (change.field === "text") {
      fields.add("content");
    } else if (change.field === "className") {
      fields.add("class");
    } else if (change.field.startsWith("rect.")) {
      fields.add("layout");
    } else if (change.field.startsWith("styles.")) {
      fields.add("style");
    } else if (change.field.startsWith("state.")) {
      fields.add("state");
    } else if (change.field.startsWith("attributes.")) {
      fields.add("attributes");
    } else {
      fields.add(change.field);
    }
  }

  return [...fields];
}

function buildCrossTargetSummary(comparison: CrossTargetComparison): string[] {
  const summary: string[] = [
    `cross-target compare: ${formatTarget(comparison.leftTarget, comparison.leftTargetType)} vs ${formatTarget(
      comparison.rightTarget,
      comparison.rightTargetType
    )}`
  ];
  const missingElements = comparison.elementComparisons.filter(
    (element) => element.status === "left-only" || element.status === "right-only"
  );
  const changedElements = comparison.elementComparisons.filter(
    (element) => element.status === "matched" && element.differences.length > 0
  );

  if (!comparison.changed) {
    summary.push("no measured cross-target differences");
    return summary;
  }

  if (comparison.pageChanges.length > 0) {
    summary.push(`page differs: ${comparison.pageChanges.map((change) => change.field).join(", ")}`);
  }

  if (missingElements.length > 0) {
    summary.push(`elements missing on one target: ${missingElements.length}`);
  }

  if (changedElements.length > 0) {
    summary.push(`matched elements with measured differences: ${changedElements.length}`);
  }

  for (const element of [...missingElements, ...changedElements].slice(0, 6)) {
    summary.push(...element.summary);
  }

  if (comparison.consoleChanges.leftOnly.length > 0 || comparison.consoleChanges.rightOnly.length > 0) {
    summary.push(
      `console differs: left-only ${comparison.consoleChanges.leftOnly.length}, right-only ${comparison.consoleChanges.rightOnly.length}`
    );
  }

  if (comparison.errorChanges.leftOnly.length > 0 || comparison.errorChanges.rightOnly.length > 0) {
    summary.push(
      `errors differ: left-only ${comparison.errorChanges.leftOnly.length}, right-only ${comparison.errorChanges.rightOnly.length}`
    );
  }

  return summary;
}

function buildCrossTargetNextProbes(comparison: CrossTargetComparison): string[] {
  if (!comparison.changed) {
    return ["No next probe needed unless the user reports a behavior that is not represented in this snapshot."];
  }

  const probes: string[] = [];
  const riskFields = new Set(
    comparison.elementComparisons.flatMap((element) => element.riskFields)
  );

  if (riskFields.has("presence")) {
    probes.push("Query missing elements on both targets using stable id or data-testid selectors.");
  }

  if (riskFields.has("layout") || riskFields.has("style")) {
    probes.push("Capture focused snapshots for changed layout and style selectors on both targets.");
  }

  if (riskFields.has("content") || riskFields.has("state") || riskFields.has("class")) {
    probes.push("Perform the same interaction on both targets, then compare before and after snapshots.");
  }

  if (comparison.errorChanges.leftOnly.length > 0 || comparison.errorChanges.rightOnly.length > 0) {
    probes.push("Inspect runtime errors on the target that has unique errors before changing UI code.");
  }

  if (comparison.consoleChanges.leftOnly.length > 0 || comparison.consoleChanges.rightOnly.length > 0) {
    probes.push("Compare console output around the same interaction to confirm whether handlers fired.");
  }

  return probes.length > 0 ? probes : ["Capture a narrower snapshot around the differing selectors."];
}

function formatTarget(target: string, targetType: string | undefined): string {
  return targetType ? `${target} (${targetType})` : target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortValue(value[key]);
  }
  return sorted;
}

function format(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return stableStringify(value);
}

import type {
  ConsoleEntry,
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

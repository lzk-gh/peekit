import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { InteractionRequest } from "@peekit/core";

export type RecordedCase = {
  id: string;
  name: string;
  createdAt: string;
  targetId?: string;
  steps: InteractionRequest[];
  snapshotIds: string[];
  notes?: string;
};

type CaseStoreFile = {
  version: 1;
  cases: RecordedCase[];
};

export class JsonCaseStore {
  constructor(readonly path = defaultCaseStorePath()) {}

  async load(): Promise<RecordedCase[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<CaseStoreFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.cases)) {
        throw new Error("case store schema version is unsupported");
      }
      return parsed.cases;
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read Peekit case store at ${this.path}: ${message}`);
    }
  }

  async save(cases: RecordedCase[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const payload: CaseStoreFile = {
      version: 1,
      cases
    };
    await writeFile(this.path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

export function defaultCaseStorePath(): string {
  return resolve(process.cwd(), ".peekit", "cases.json");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

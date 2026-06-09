import type { RuntimeError } from "./types.js";

export function normalizeUnknownError(error: unknown, source = "runtime"): RuntimeError {
  if (error instanceof Error) {
    return {
      source,
      message: error.message,
      stack: error.stack
    };
  }

  if (typeof error === "string") {
    return {
      source,
      message: error
    };
  }

  return {
    source,
    message: safeJson(error)
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

import type { AdapterCapabilities, CapabilityLevel, TargetKind } from "./types.js";

export const ADAPTER_CAPABILITY_FIELDS = [
  "launch",
  "queryElement",
  "getMarkup",
  "getText",
  "getRect",
  "getStyle",
  "tap",
  "input",
  "scroll",
  "console"
] as const;

export const EMPTY_CAPABILITIES: AdapterCapabilities = {
  launch: false,
  queryElement: false,
  getMarkup: false,
  getText: false,
  getRect: false,
  getStyle: false,
  tap: false,
  input: false,
  scroll: false,
  console: false
};

export const H5_CAPABILITIES: AdapterCapabilities = {
  launch: true,
  queryElement: true,
  getMarkup: true,
  getText: true,
  getRect: true,
  getStyle: true,
  tap: true,
  input: true,
  scroll: true,
  console: true
};

export const PLANNED_MINI_PROGRAM_CAPABILITIES: AdapterCapabilities = {
  launch: false,
  queryElement: false,
  getMarkup: false,
  getText: false,
  getRect: false,
  getStyle: false,
  tap: false,
  input: false,
  scroll: false,
  console: false
};

export const WEIXIN_MINI_PROGRAM_CAPABILITIES: AdapterCapabilities = {
  launch: true,
  queryElement: true,
  getMarkup: true,
  getText: true,
  getRect: true,
  getStyle: true,
  tap: true,
  input: true,
  scroll: true,
  console: true
};

export function capabilityLevelFromCapabilities(
  capabilities: AdapterCapabilities
): CapabilityLevel {
  const supported = ADAPTER_CAPABILITY_FIELDS.filter((field) => capabilities[field]).length;

  if (supported === 0) {
    return 0;
  }

  if (supported <= 3) {
    return 1;
  }

  if (supported <= 6) {
    return 2;
  }

  if (supported < ADAPTER_CAPABILITY_FIELDS.length) {
    return 3;
  }

  return 4;
}

export function getDefaultCapabilities(kind: TargetKind): AdapterCapabilities {
  if (kind === "h5") {
    return H5_CAPABILITIES;
  }

  if (kind === "mp-weixin") {
    return WEIXIN_MINI_PROGRAM_CAPABILITIES;
  }

  return PLANNED_MINI_PROGRAM_CAPABILITIES;
}

export function getCapabilityMatrix(): Record<
  TargetKind,
  { level: CapabilityLevel; capabilities: AdapterCapabilities; status: string }
> {
  const matrix: Record<
    TargetKind,
    { level: CapabilityLevel; capabilities: AdapterCapabilities; status: string }
  > = {
    h5: {
      level: capabilityLevelFromCapabilities(H5_CAPABILITIES),
      capabilities: H5_CAPABILITIES,
      status: "implemented"
    },
    "mp-weixin": {
      level: capabilityLevelFromCapabilities(WEIXIN_MINI_PROGRAM_CAPABILITIES),
      capabilities: WEIXIN_MINI_PROGRAM_CAPABILITIES,
      status: "implemented"
    },
    "mp-alipay": {
      level: 0,
      capabilities: PLANNED_MINI_PROGRAM_CAPABILITIES,
      status: "planned"
    },
    "mp-bytedance": {
      level: 0,
      capabilities: PLANNED_MINI_PROGRAM_CAPABILITIES,
      status: "planned"
    },
    "mp-qq": {
      level: 0,
      capabilities: PLANNED_MINI_PROGRAM_CAPABILITIES,
      status: "planned"
    }
  };

  return matrix;
}

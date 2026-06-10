type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type PeekitToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

const targetConfigSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    type: {
      type: "string",
      enum: ["h5", "mp-weixin", "mp-alipay", "mp-bytedance", "mp-qq"]
    },
    url: { type: "string" },
    route: { type: "string" },
    rootDir: { type: "string" },
    projectPath: { type: "string" },
    cliPath: { type: "string" },
    wsEndpoint: { type: "string" },
    port: { type: "number" },
    account: { type: "string" },
    ticket: { type: "string" },
    trustProject: { type: "boolean" },
    automation: {
      type: "object",
      properties: {
        servicePortEnabled: { type: "boolean" }
      }
    },
    browser: { type: "string", enum: ["chromium", "firefox", "webkit"] },
    browserPath: { type: "string" },
    headless: { type: "boolean" },
    viewport: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" }
      },
      required: ["width", "height"]
    },
    connectOverCDP: { type: "string" },
    timeoutMs: { type: "number" },
    metadata: { type: "object" }
  },
  required: ["type"]
};

const targetIdProperty = {
  targetId: {
    type: "string",
    description: "Connected target id. Omit to use the active target."
  }
};

export const PEEKIT_TOOLS: PeekitToolDefinition[] = [
  {
    name: "peekit_inspect_environment",
    description: "Safely inspect project type, local toolchain, loopback ports, MCP client paths, and setup blockers.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" }
      }
    }
  },
  {
    name: "peekit_suggest_target_config",
    description: "Suggest H5 or mini program target configs from safe local environment evidence.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        preferredKind: {
          type: "string",
          enum: ["h5", "mp-weixin", "mp-alipay", "mp-bytedance", "mp-qq"]
        }
      }
    }
  },
  {
    name: "peekit_suggest_mcp_client_config",
    description: "Suggest MCP client config snippets without reading or writing client config files.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        clientName: { type: "string" },
        serverName: { type: "string" },
        command: { type: "string" },
        args: {
          type: "array",
          items: { type: "string" }
        },
        env: { type: "object" }
      }
    }
  },
  {
    name: "peekit_validate_target",
    description: "Validate whether a target config is safely connectable and report structured setup blockers.",
    inputSchema: {
      type: "object",
      properties: {
        target: targetConfigSchema
      },
      required: ["target"]
    }
  },
  {
    name: "peekit_explain_setup_blocker",
    description: "Explain setup blockers in agent-readable language with remediation guidance.",
    inputSchema: {
      type: "object",
      properties: {
        validation: { type: "object" },
        target: targetConfigSchema
      }
    }
  },
  {
    name: "peekit_list_targets",
    description: "List connected targets and the Peekit capability matrix.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "peekit_connect_target",
    description: "Connect a target runtime and make it the active target.",
    inputSchema: targetConfigSchema
  },
  {
    name: "peekit_get_current_page",
    description: "Read current page evidence from the active or specified target.",
    inputSchema: {
      type: "object",
      properties: targetIdProperty
    }
  },
  {
    name: "peekit_open_page",
    description: "Open a page or route in the active or specified target.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetIdProperty,
        url: { type: "string" }
      },
      required: ["url"]
    }
  },
  {
    name: "peekit_query_element",
    description: "Capture runtime evidence for one element selector.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetIdProperty,
        selector: { type: "string" }
      },
      required: ["selector"]
    }
  },
  {
    name: "peekit_query_all",
    description: "Capture runtime evidence for all matching elements.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetIdProperty,
        selector: { type: "string" },
        maxResults: { type: "number" }
      },
      required: ["selector"]
    }
  },
  {
    name: "peekit_capture_snapshot",
    description: "Capture page, element, console, error, and optional screenshot evidence.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetIdProperty,
        snapshotId: { type: "string" },
        selectors: {
          type: "array",
          items: { type: "string" }
        },
        maxElements: { type: "number" },
        includeScreenshot: { type: "boolean" },
        label: { type: "string" }
      }
    }
  },
  {
    name: "peekit_perform_interaction",
    description: "Perform click, tap, input, scroll, or hover and return before/after evidence.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetIdProperty,
        action: {
          type: "string",
          enum: ["tap", "click", "input", "scroll", "hover"]
        },
        selector: { type: "string" },
        text: { type: "string" },
        value: { type: "string" },
        scroll: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" }
          }
        },
        waitAfterMs: { type: "number" }
      },
      required: ["action"]
    }
  },
  {
    name: "peekit_compare_snapshots",
    description: "Compare two snapshots by id or inline snapshot objects.",
    inputSchema: {
      type: "object",
      properties: {
        beforeSnapshotId: { type: "string" },
        afterSnapshotId: { type: "string" },
        before: { type: "object" },
        after: { type: "object" }
      }
    }
  },
  {
    name: "peekit_diagnose_issue",
    description: "Diagnose likely causes from runtime evidence and optional snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        problem: { type: "string" },
        evidence: {
          type: "array",
          items: { type: "object" }
        },
        beforeSnapshotId: { type: "string" },
        afterSnapshotId: { type: "string" },
        before: { type: "object" },
        after: { type: "object" },
        diff: { type: "object" }
      }
    }
  },
  {
    name: "peekit_suggest_next_probe",
    description: "Suggest the next runtime probes when evidence is insufficient.",
    inputSchema: {
      type: "object",
      properties: {
        problem: { type: "string" },
        evidence: {
          type: "array",
          items: { type: "object" }
        },
        beforeSnapshotId: { type: "string" },
        afterSnapshotId: { type: "string" },
        before: { type: "object" },
        after: { type: "object" },
        diff: { type: "object" }
      }
    }
  },
  {
    name: "peekit_record_case",
    description: "Record a reproducible runtime case in memory for the current MCP session.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        targetId: { type: "string" },
        steps: {
          type: "array",
          items: { type: "object" }
        },
        snapshotIds: {
          type: "array",
          items: { type: "string" }
        },
        notes: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    name: "peekit_replay_case",
    description: "Replay a recorded in-memory case against the active or specified target.",
    inputSchema: {
      type: "object",
      properties: {
        caseId: { type: "string" },
        name: { type: "string" },
        targetId: { type: "string" }
      }
    }
  },
  {
    name: "peekit_cross_target_compare",
    description: "Compare runtime evidence across two targets with page, element, console, error, summary, and next-probe output.",
    inputSchema: {
      type: "object",
      properties: {
        leftSnapshotId: { type: "string" },
        rightSnapshotId: { type: "string" },
        left: { type: "object" },
        right: { type: "object" }
      }
    }
  }
];

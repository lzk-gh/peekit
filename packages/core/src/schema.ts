import { z } from "zod";

export const TargetKindSchema = z.enum([
  "h5",
  "mp-weixin",
  "mp-alipay",
  "mp-bytedance",
  "mp-qq"
]);

export const CapabilityLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4)
]);

export const AdapterCapabilitiesSchema = z.object({
  launch: z.boolean(),
  queryElement: z.boolean(),
  getMarkup: z.boolean(),
  getText: z.boolean(),
  getRect: z.boolean(),
  getStyle: z.boolean(),
  tap: z.boolean(),
  input: z.boolean(),
  scroll: z.boolean(),
  console: z.boolean()
});

export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const PageEvidenceSchema = z.object({
  url: z.string().optional(),
  route: z.string().optional(),
  title: z.string().optional(),
  query: z.record(z.string(), z.string()).optional(),
  viewport: ViewportSchema.optional(),
  scroll: z.object({ x: z.number(), y: z.number() }).optional()
});

export const ElementEvidenceSchema = z.object({
  selector: z.string(),
  tag: z.string().optional(),
  text: z.string().optional(),
  className: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  markup: z.string().optional(),
  rect: z
    .object({
      left: z.number(),
      top: z.number(),
      width: z.number(),
      height: z.number()
    })
    .optional(),
  styles: z.record(z.string(), z.string()).optional(),
  state: z.record(z.string(), z.unknown()).optional()
});

export const ConsoleEntrySchema = z.object({
  type: z.string(),
  text: z.string(),
  location: z.string().optional()
});

export const RuntimeErrorSchema = z.object({
  source: z.string(),
  message: z.string(),
  stack: z.string().optional()
});

export const UnsupportedFieldSchema = z.object({
  field: z.string(),
  reason: z.string()
});

export const InteractionActionSchema = z.enum(["tap", "click", "input", "scroll", "hover"]);

export const RuntimeEvidenceSchema = z.object({
  target: z.string(),
  targetType: TargetKindSchema.optional(),
  capabilityLevel: CapabilityLevelSchema,
  page: PageEvidenceSchema,
  element: ElementEvidenceSchema.optional(),
  interaction: z
    .object({
      action: InteractionActionSchema,
      before: z.unknown().optional(),
      after: z.unknown().optional()
    })
    .optional(),
  console: z.array(ConsoleEntrySchema),
  errors: z.array(RuntimeErrorSchema),
  unsupported: z.array(UnsupportedFieldSchema).optional(),
  timestamp: z.string().optional()
});

export const RuntimeSnapshotSchema = RuntimeEvidenceSchema.extend({
  kind: z.literal("snapshot"),
  snapshotId: z.string().optional(),
  capturedAt: z.string(),
  elements: z.array(ElementEvidenceSchema),
  screenshot: z
    .object({
      mimeType: z.string(),
      data: z.string().optional(),
      path: z.string().optional()
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const PeekitTargetConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: TargetKindSchema,
  url: z.string().optional(),
  route: z.string().optional(),
  rootDir: z.string().optional(),
  projectPath: z.string().optional(),
  cliPath: z.string().optional(),
  wsEndpoint: z.string().optional(),
  port: z.number().int().positive().optional(),
  account: z.string().optional(),
  ticket: z.string().optional(),
  trustProject: z.boolean().optional(),
  browser: z.enum(["chromium", "firefox", "webkit"]).optional(),
  headless: z.boolean().optional(),
  viewport: ViewportSchema.optional(),
  connectOverCDP: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const InteractionRequestSchema = z.object({
  action: InteractionActionSchema,
  selector: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  scroll: z.object({ x: z.number().optional(), y: z.number().optional() }).optional(),
  waitAfterMs: z.number().int().nonnegative().optional()
});

export const CaptureSnapshotOptionsSchema = z.object({
  selectors: z.array(z.string()).optional(),
  maxElements: z.number().int().positive().optional(),
  includeScreenshot: z.boolean().optional()
});

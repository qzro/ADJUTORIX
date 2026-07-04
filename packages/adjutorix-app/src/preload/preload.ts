// @ts-nocheck
import { contextBridge as __adjutorixContextBridgeV13, ipcRenderer as __adjutorixIpcRendererV13, contextBridge } from "electron";
import { contextBridge, ipcRenderer } from "electron";
import { BRIDGE_CHANNELS } from "./bridge.js";
import { createExposedApi } from "./exposed_api.js";

/**
 * ADJUTORIX APP — PRELOAD / preload.ts
 *
 * Canonical trusted renderer bridge for the Electron preload context.
 *
 * Purpose:
 * - expose a minimal, typed, immutable API from main to renderer
 * - prevent direct renderer access to Node/Electron ambient authority
 * - validate all renderer-originated payloads before IPC transport
 * - normalize all IPC results into deterministic envelopes
 * - provide a single governed bridge surface instead of ad hoc ipcRenderer usage
 * - support subscription APIs with explicit teardown and event sanitation
 *
 * Threat model:
 * - renderer code is not trusted with filesystem, shell, process, or raw IPC authority
 * - preload must not leak ipcRenderer, Event objects, or executable capabilities
 * - malformed payloads must fail before crossing the process boundary
 * - event listeners must be scoped, removable, and payload-only
 *
 * Hard invariants:
 * - only allowlisted channels are reachable from renderer
 * - every invoke payload is schema-validated at preload boundary
 * - returned objects are normalized plain data, not privileged objects/functions
 * - subscriptions expose explicit unsubscribe functions only
 * - bridge object is deeply frozen before exposure
 * - identical semantic payloads normalize identically
 *
 * NO PLACEHOLDERS.
 */

// -----------------------------------------------------------------------------
// BASIC JSON / NORMALIZATION TYPES
// -----------------------------------------------------------------------------

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type Unsubscribe = () => void;

type RendererActor = "renderer";

type InvokeEnvelope<T extends JsonValue = JsonValue> = {
  ok: true;
  data: T;
  meta: {
    channel: string;
    requestHash: string;
  };
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: JsonObject;
  };
  meta: {
    channel: string;
    requestHash: string;
  };
};

type Envelope<T extends JsonValue = JsonValue> = InvokeEnvelope<T> | ErrorEnvelope;

// -----------------------------------------------------------------------------
// IPC CHANNELS
// -----------------------------------------------------------------------------

const CHANNELS = BRIDGE_CHANNELS;
const ADJUTORIX_SHELL_EXECUTE_CHANNEL = "adjutorix:shell:execute";

const INVOKE_CHANNEL_ALLOWLIST = new Set<string>([
  CHANNELS.runtimeSnapshot,
  CHANNELS.workspaceOpen,
  CHANNELS.workspaceClose,
  CHANNELS.workspaceReveal,
  CHANNELS.workspaceHealth,
  CHANNELS.workspaceFileRead,
  CHANNELS.workspaceTrustRead,
  CHANNELS.workspaceTrustSet,
  CHANNELS.patchPreview,
  CHANNELS.patchApprove,
  CHANNELS.patchApply,
  CHANNELS.patchClear,
  CHANNELS.verifyRun,
  CHANNELS.verifyStatus,
  CHANNELS.verifyBind,
  CHANNELS.ledgerCurrent,
  CHANNELS.ledgerTimeline,
  CHANNELS.ledgerEntry,
  CHANNELS.ledgerHeads,
  CHANNELS.ledgerStats,
  CHANNELS.diagnosticsRuntime,
  CHANNELS.diagnosticsStartup,
  CHANNELS.diagnosticsObservability,
  CHANNELS.diagnosticsLogTail,
  CHANNELS.diagnosticsCrash,
  CHANNELS.diagnosticsExport,
  CHANNELS.agentHealth,
  CHANNELS.agentStatus,
  CHANNELS.agentStart,
  CHANNELS.agentStop,
  ADJUTORIX_SHELL_EXECUTE_CHANNEL,
]);

const EVENT_CHANNEL_ALLOWLIST = new Set<string>([
  CHANNELS.uiWorkspaceEvent,
  CHANNELS.uiAgentEvent,
  CHANNELS.uiDiagnosticsEvent,
  CHANNELS.uiPatchEvent,
  CHANNELS.uiVerifyEvent,
]);

// -----------------------------------------------------------------------------
// REQUEST / PAYLOAD TYPES
// -----------------------------------------------------------------------------

type WorkspaceOpenRequest = {
  schema: 1;
  actor: RendererActor;
  rootPath?: string;
  workspacePath?: string;
  source: "ipc" | "menu" | "startup" | "system" | "reopen";
};

type WorkspaceRevealRequest = {
  schema: 1;
  actor: RendererActor;
  targetPath: string;
};
type WorkspaceFileReadRequest = WorkspaceRevealRequest;

type WorkspaceTrustSetRequest = {
  schema: 1;
  actor: RendererActor;
  workspacePath: string;
  level: "untrusted" | "restricted" | "trusted";
  reason: string;
  notes?: string;
};

type PatchPreviewRequest = {
  schema: 1;
  actor: RendererActor;
  prompt: string;
  targetPaths: string[];
  traceId?: string;
};

type PatchApproveRequest = {
  schema: 1;
  actor: RendererActor;
  patchId: string;
  previewHash: string;
};

type PatchApplyRequest = {
  schema: 1;
  actor: RendererActor;
  patchId: string;
  previewHash: string;
  requestHash: string;
  traceId?: string;
  operatorKernelReceiptId?: string;
  operatorKernelHash?: string;
  operatorKernel?: JsonObject;
};

type VerifyRunRequest = {
  schema: 1;
  actor: RendererActor;
  targets: string[];
  previewHash?: string;
  trace_id?: string;
};

type VerifyStatusRequest = {
  schema: 1;
  verifyId?: string;
  verify_id?: string;
};

type VerifyBindRequest = {
  schema: 1;
  verifyId: string;
  passed: boolean;
  summary?: Record<string, JsonValue>;
};

type LedgerTimelineRequest = {
  startSeq?: number;
  endSeq?: number;
  limit?: number;
  kinds?: string[];
  reverse?: boolean;
};

type LedgerEntryRequest = {
  entryId?: string;
  seq?: number;
};

type DiagnosticsLogTailRequest = {
  target: "main" | "observability" | "custom";
  lines?: number;
  bytes?: number;
  customFileName?: string;
};

type DiagnosticsExportRequest = {
  includeRuntimeSnapshot?: boolean;
  includeStartupReport?: boolean;
  includeObservability?: boolean;
  includeLogTail?: boolean;
  includeCrashContext?: boolean;
  logTailLines?: number;
  promptForPath?: boolean;
};

type AgentControlRequest = {
  schema: 1;
  actor: RendererActor;
  reason?: string;
};

type EventPayload = JsonValue;

type EventCallback<T extends EventPayload = EventPayload> = (payload: T) => void;

// -----------------------------------------------------------------------------
// LOW-LEVEL HELPERS
// -----------------------------------------------------------------------------

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`preload:${message}`);
}

function stableJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = normalize((v as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(normalize(value));
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeJson(value: unknown): JsonValue {
  const seen = new WeakSet<object>();

  const visit = (input: unknown): JsonValue => {
    if (input === null || input === undefined) return null;

    if (typeof input === "string") return input;
    if (typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input === "bigint") return String(input);
    if (typeof input === "symbol" || typeof input === "function") return null;

    if (input instanceof Date) return input.toISOString();

    if (input instanceof Error) {
      const out: Record<string, JsonValue> = {
        name: input.name,
        message: input.message,
        stack: input.stack ?? null,
      };
      const cause = (input as { cause?: unknown }).cause;
      if (cause !== undefined) out.cause = visit(cause);
      return out;
    }

    if (Array.isArray(input)) return input.map((item) => visit(item));

    if (typeof input === "object") {
      if (seen.has(input)) return "[Circular]";
      seen.add(input);

      const out: Record<string, JsonValue> = {};
      for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
        out[key] = visit(child);
      }

      seen.delete(input);
      return out;
    }

    return null;
  };

  return visit(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested && typeof nested === "object") deepFreeze(nested);
    }
  }
  return value;
}

function envelopeError(channel: string, requestHash: string, error: unknown): ErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: "IPC_INVOKE_FAILED",
      message,
    },
    meta: {
      channel,
      requestHash,
    },
  };
}

async function computeRequestHash(channel: string, payload: JsonValue): Promise<string> {
  return await sha256Hex(stableJson({ channel, payload }));
}

function requireString(value: unknown, field: string, min = 1): string {
  assert(typeof value === "string", `${field}_must_be_string`);
  const trimmed = value.trim();
  assert(trimmed.length >= min, `${field}_must_be_nonempty`);
  return trimmed;
}

function requireOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function requireBoolean(value: unknown, field: string): boolean {
  assert(typeof value === "boolean", `${field}_must_be_boolean`);
  return value;
}

function requireOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requireBoolean(value, field);
}

function requireInteger(value: unknown, field: string, min?: number): number {
  assert(typeof value === "number" && Number.isInteger(value), `${field}_must_be_integer`);
  if (min !== undefined) assert(value >= min, `${field}_must_be_gte_${min}`);
  return value;
}

function requireOptionalInteger(value: unknown, field: string, min?: number): number | undefined {
  if (value === undefined) return undefined;
  return requireInteger(value, field, min);
}

function requireStringArray(value: unknown, field: string, options?: { nonEmpty?: boolean; max?: number }): string[] {
  assert(Array.isArray(value), `${field}_must_be_array`);
  const out = value.map((item, index) => requireString(item, `${field}_${index}`));
  const deduped = [...new Set(out)].sort((a, b) => a.localeCompare(b));
  if (options?.nonEmpty) assert(deduped.length > 0, `${field}_must_be_nonempty_array`);
  if (options?.max !== undefined) assert(deduped.length <= options.max, `${field}_too_large`);
  return deduped;
}

function requireOptionalStringArray(value: unknown, field: string, options?: { nonEmpty?: boolean; max?: number }): string[] | undefined {
  if (value === undefined) return undefined;
  return requireStringArray(value, field, options);
}

function requireJsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  assert(isPlainObject(value), `${field}_must_be_object`);
  return normalizeJson(value) as Record<string, JsonValue>;
}

function normalizeEnvelopeData<T extends JsonValue>(channel: string, requestHash: string, value: unknown): InvokeEnvelope<T> {
  return {
    ok: true,
    data: normalizeJson(value) as T,
    meta: {
      channel,
      requestHash,
    },
  };
}

// -----------------------------------------------------------------------------
// REQUEST NORMALIZERS
// -----------------------------------------------------------------------------

function normalizeWorkspaceOpenRequest(input: unknown): WorkspaceOpenRequest {
  const obj = requireJsonRecord(input, "workspace_open_request");
  const source = requireString(obj.source, "source") as WorkspaceOpenRequest["source"];
  assert(["ipc", "menu", "startup", "system", "reopen"].includes(source), "source_invalid");

  const rootPath =
    obj.rootPath !== undefined
      ? requireString(obj.rootPath, "rootPath")
      : obj.workspacePath !== undefined
        ? requireString(obj.workspacePath, "workspacePath")
        : undefined;

  return {
    schema: 1,
    actor: "renderer",
    ...(rootPath ? { rootPath, workspacePath: rootPath } : {}),
    source,
  };
}

function normalizeWorkspaceRevealRequest(input: unknown): WorkspaceRevealRequest {
  const obj = requireJsonRecord(input, "workspace_reveal_request");
  return {
    schema: 1,
    actor: "renderer",
    targetPath: requireString(obj.targetPath, "targetPath"),
  };
}

function workspaceFileReadPathFromUnknown(input: unknown): string {
  if (typeof input === "string" && input.trim()) return input.trim();

  if (Array.isArray(input)) {
    for (const item of input) {
      const value = workspaceFileReadPathFromUnknown(item);
      if (value) return value;
    }
    return "";
  }

  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;

  for (const key of ["path", "targetPath", "relativePath", "relative_path", "workspacePath", "workspace_path", "filePath", "file_path"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  for (const key of ["payload", "request", "input", "data", "args", "body", "params"]) {
    const value = workspaceFileReadPathFromUnknown(obj[key]);
    if (value) return value;
  }

  return "";
}

function normalizeWorkspaceFileReadRequest(input: unknown): WorkspaceFileReadRequest {
  const obj = requireJsonRecord(input, "workspace_file_read_request");
  const readPath = workspaceFileReadPathFromUnknown(obj);

  assert(readPath.length > 0, "workspace_file_read_path_required");

  return {
    schema: 1,
    actor: "renderer",
    ...obj,
    path: readPath,
    targetPath: readPath,
    relativePath: readPath,
    relative_path: readPath,
    workspacePath: readPath,
    workspace_path: readPath,
    filePath: readPath,
    file_path: readPath,
  } as WorkspaceFileReadRequest;
}


function normalizeWorkspaceTrustSetRequest(input: unknown): WorkspaceTrustSetRequest {
  const obj = requireJsonRecord(input, "workspace_trust_set_request");
  const level = requireString(obj.level, "level") as WorkspaceTrustSetRequest["level"];
  assert(["untrusted", "restricted", "trusted"].includes(level), "level_invalid");
  const notes = requireOptionalString(obj.notes, "notes");
  return {
    schema: 1,
    actor: "renderer",
    workspacePath: requireString(obj.workspacePath, "workspacePath"),
    level,
    reason: requireString(obj.reason, "reason"),
    ...(notes ? { notes } : {}),
  };
}

function normalizePatchPreviewRequest(input: unknown): PatchPreviewRequest {
  const obj = requireJsonRecord(input, "patch_preview_request");
  const traceId = requireOptionalString(obj.traceId, "traceId");
  return {
    schema: 1,
    actor: "renderer",
    prompt: requireString(obj.prompt, "prompt"),
    targetPaths: requireStringArray(obj.targetPaths, "targetPaths", { nonEmpty: true, max: 4096 }),
    ...(traceId ? { traceId } : {}),
  };
}

function normalizePatchApproveRequest(input: unknown): PatchApproveRequest {
  const obj = requireJsonRecord(input, "patch_approve_request");
  return {
    schema: 1,
    actor: "renderer",
    patchId: requireString(obj.patchId, "patchId"),
    previewHash: requireString(obj.previewHash, "previewHash"),
  };
}

function normalizePatchApplyRequest(input: unknown): PatchApplyRequest {
  const obj = requireJsonRecord(input, "patch_apply_request");
  const traceId = requireOptionalString(obj.traceId, "traceId");
  const operatorKernelReceiptId = requireOptionalString(obj.operatorKernelReceiptId, "operatorKernelReceiptId");
  const operatorKernelHash = requireOptionalString(obj.operatorKernelHash, "operatorKernelHash");
  const operatorKernel = obj.operatorKernel !== undefined
    ? requireJsonRecord(obj.operatorKernel, "operatorKernel")
    : undefined;

  return {
    schema: 1,
    actor: "renderer",
    patchId: requireString(obj.patchId, "patchId"),
    previewHash: requireString(obj.previewHash, "previewHash"),
    requestHash: requireString(obj.requestHash, "requestHash"),
    ...(traceId ? { traceId } : {}),
    ...(operatorKernelReceiptId ? { operatorKernelReceiptId } : {}),
    ...(operatorKernelHash ? { operatorKernelHash } : {}),
    ...(operatorKernel ? { operatorKernel } : {}),
  };
}

function normalizeVerifyRunRequest(input: unknown): VerifyRunRequest {
  const obj = requireJsonRecord(input, "verify_run_request");
  const previewHash = requireOptionalString(obj.previewHash, "previewHash");
  const traceId = requireOptionalString(obj.trace_id, "trace_id");
  return {
    schema: 1,
    actor: "renderer",
    targets: requireStringArray(obj.targets, "targets", { max: 2048 }),
    ...(previewHash ? { previewHash } : {}),
    ...(traceId ? { trace_id: traceId } : {}),
  };
}

function normalizeVerifyStatusRequest(input: unknown): VerifyStatusRequest {
  const obj = requireJsonRecord(input ?? {}, "verify_status_request");
  const verifyId = requireOptionalString(obj.verifyId, "verifyId");
  const verify_id = requireOptionalString(obj.verify_id, "verify_id");
  return {
    schema: 1,
    ...(verifyId ? { verifyId } : {}),
    ...(verify_id ? { verify_id } : {}),
  };
}

function normalizeVerifyBindRequest(input: unknown): VerifyBindRequest {
  const obj = requireJsonRecord(input, "verify_bind_request");
  const summary = obj.summary !== undefined ? requireJsonRecord(obj.summary, "summary") : undefined;
  return {
    schema: 1,
    verifyId: requireString(obj.verifyId, "verifyId"),
    passed: requireBoolean(obj.passed, "passed"),
    ...(summary ? { summary } : {}),
  };
}

function normalizeLedgerTimelineRequest(input: unknown): LedgerTimelineRequest {
  const obj = requireJsonRecord(input ?? {}, "ledger_timeline_request");
  const kinds = requireOptionalStringArray(obj.kinds, "kinds", { max: 128 });
  return {
    ...(obj.startSeq !== undefined ? { startSeq: requireInteger(obj.startSeq, "startSeq", 0) } : {}),
    ...(obj.endSeq !== undefined ? { endSeq: requireInteger(obj.endSeq, "endSeq", 0) } : {}),
    ...(obj.limit !== undefined ? { limit: requireInteger(obj.limit, "limit", 1) } : {}),
    ...(kinds ? { kinds } : {}),
    ...(obj.reverse !== undefined ? { reverse: requireBoolean(obj.reverse, "reverse") } : {}),
  };
}

function normalizeLedgerEntryRequest(input: unknown): LedgerEntryRequest {
  const obj = requireJsonRecord(input ?? {}, "ledger_entry_request");
  const entryId = requireOptionalString(obj.entryId, "entryId");
  const seq = requireOptionalInteger(obj.seq, "seq", 0);
  assert(entryId !== undefined || seq !== undefined, "ledger_entry_requires_entryId_or_seq");
  return {
    ...(entryId ? { entryId } : {}),
    ...(seq !== undefined ? { seq } : {}),
  };
}

function normalizeDiagnosticsLogTailRequest(input: unknown): DiagnosticsLogTailRequest {
  const obj = requireJsonRecord(input, "diagnostics_log_tail_request");
  const target = requireString(obj.target, "target") as DiagnosticsLogTailRequest["target"];
  assert(["main", "observability", "custom"].includes(target), "diagnostics_target_invalid");
  const customFileName = requireOptionalString(obj.customFileName, "customFileName");
  return {
    target,
    ...(obj.lines !== undefined ? { lines: requireInteger(obj.lines, "lines", 1) } : {}),
    ...(obj.bytes !== undefined ? { bytes: requireInteger(obj.bytes, "bytes", 1) } : {}),
    ...(customFileName ? { customFileName } : {}),
  };
}

function normalizeDiagnosticsExportRequest(input: unknown): DiagnosticsExportRequest {
  const obj = requireJsonRecord(input ?? {}, "diagnostics_export_request");
  return {
    ...(obj.includeRuntimeSnapshot !== undefined ? { includeRuntimeSnapshot: requireBoolean(obj.includeRuntimeSnapshot, "includeRuntimeSnapshot") } : {}),
    ...(obj.includeStartupReport !== undefined ? { includeStartupReport: requireBoolean(obj.includeStartupReport, "includeStartupReport") } : {}),
    ...(obj.includeObservability !== undefined ? { includeObservability: requireBoolean(obj.includeObservability, "includeObservability") } : {}),
    ...(obj.includeLogTail !== undefined ? { includeLogTail: requireBoolean(obj.includeLogTail, "includeLogTail") } : {}),
    ...(obj.includeCrashContext !== undefined ? { includeCrashContext: requireBoolean(obj.includeCrashContext, "includeCrashContext") } : {}),
    ...(obj.logTailLines !== undefined ? { logTailLines: requireInteger(obj.logTailLines, "logTailLines", 1) } : {}),
    ...(obj.promptForPath !== undefined ? { promptForPath: requireBoolean(obj.promptForPath, "promptForPath") } : {}),
  };
}

function normalizeAgentControlRequest(input: unknown): AgentControlRequest {
  const obj = requireJsonRecord(input ?? {}, "agent_control_request");
  const reason = requireOptionalString(obj.reason, "reason");
  return {
    schema: 1,
    actor: "renderer",
    ...(reason ? { reason } : {}),
  };
}

function normalizeShellExecuteRequest(input: unknown): JsonObject {
  const obj = requireJsonRecord(input ?? {}, "shell_execute_request");
  const command =
    typeof obj.command === "string"
      ? obj.command.trim()
      : typeof obj.intent === "string"
        ? obj.intent.trim()
        : "";

  assert(command.length > 0, "command_required");
  assert(command.length <= 8000, "command_too_large");

  const cwd =
    typeof obj.cwd === "string" && obj.cwd.trim()
      ? obj.cwd.trim()
      : undefined;

  return {
    schema: 1,
    actor: "renderer",
    source: "ipc",
    command,
    ...(cwd ? { cwd } : {}),
    ...(typeof obj.timeoutMs === "number" ? { timeoutMs: obj.timeoutMs } : {}),
  };
}

// -----------------------------------------------------------------------------
// IPC INVOKE / EVENT ADAPTERS
// -----------------------------------------------------------------------------

async function guardedInvoke<T extends JsonValue>(channel: string, payload: JsonValue): Promise<Envelope<T>> {
  assert(INVOKE_CHANNEL_ALLOWLIST.has(channel), "channel_not_allowlisted");
  const normalizedPayload = normalizeJson(payload);
  const reqHash = await computeRequestHash(channel, normalizedPayload);

  try {
    const raw = await ipcRenderer.invoke(channel, normalizedPayload);
    return deepFreeze(normalizeEnvelopeData<T>(channel, reqHash, raw));
  } catch (error) {
    return deepFreeze(envelopeError(channel, reqHash, error));
  }
}

function guardedSubscribe<T extends EventPayload>(channel: string, callback: EventCallback<T>): Unsubscribe {
  assert(EVENT_CHANNEL_ALLOWLIST.has(channel), "event_channel_not_allowlisted");
  assert(typeof callback === "function", "callback_must_be_function");

  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    callback(deepFreeze(normalizeJson(payload)) as T);
  };

  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

// -----------------------------------------------------------------------------
// BRIDGE API
// -----------------------------------------------------------------------------

const bridge = {
  meta: deepFreeze({
    version: 1 as const,
    bridge: "adjutorix.preload" as const,
  }),

  runtime: deepFreeze({
    snapshot: async () => guardedInvoke(CHANNELS.runtimeSnapshot, {}),
  }),

  workspace: deepFreeze({
    open: async (input: unknown) => guardedInvoke(CHANNELS.workspaceOpen, normalizeWorkspaceOpenRequest(input)),
    close: async () => guardedInvoke(CHANNELS.workspaceClose, {}),
    reveal: async (input: unknown) => guardedInvoke(CHANNELS.workspaceReveal, normalizeWorkspaceRevealRequest(input)),
    health: async () => guardedInvoke(CHANNELS.workspaceHealth, {}),
    readFile: async (input: unknown) => guardedInvoke(CHANNELS.workspaceFileRead, normalizeWorkspaceFileReadRequest(input)),
    trust: deepFreeze({
      read: async () => guardedInvoke(CHANNELS.workspaceTrustRead, {}),
      set: async (input: unknown) => guardedInvoke(CHANNELS.workspaceTrustSet, normalizeWorkspaceTrustSetRequest(input)),
    }),
    events: deepFreeze({
      subscribe: (callback: EventCallback) => guardedSubscribe(CHANNELS.uiWorkspaceEvent, callback),
    }),
  }),

  patch: deepFreeze({
    preview: async (input: unknown) => guardedInvoke(CHANNELS.patchPreview, normalizePatchPreviewRequest(input)),
    approve: async (input: unknown) => guardedInvoke(CHANNELS.patchApprove, normalizePatchApproveRequest(input)),
    apply: async (input: unknown) => guardedInvoke(CHANNELS.patchApply, normalizePatchApplyRequest(input)),
    clear: async () => guardedInvoke(CHANNELS.patchClear, {}),
    events: deepFreeze({
      subscribe: (callback: EventCallback) => guardedSubscribe(CHANNELS.uiPatchEvent, callback),
    }),
  }),

  verify: deepFreeze({
    run: async (input: unknown) => guardedInvoke(CHANNELS.verifyRun, normalizeVerifyRunRequest(input)),
    status: async (input?: unknown) => guardedInvoke(CHANNELS.verifyStatus, normalizeVerifyStatusRequest(input)),
    bind: async (input: unknown) => guardedInvoke(CHANNELS.verifyBind, normalizeVerifyBindRequest(input)),
    events: deepFreeze({
      subscribe: (callback: EventCallback) => guardedSubscribe(CHANNELS.uiVerifyEvent, callback),
    }),
  }),

  ledger: deepFreeze({
    current: async () => guardedInvoke(CHANNELS.ledgerCurrent, {}),
    timeline: async (input?: unknown) => guardedInvoke(CHANNELS.ledgerTimeline, normalizeLedgerTimelineRequest(input)),
    entry: async (input: unknown) => guardedInvoke(CHANNELS.ledgerEntry, normalizeLedgerEntryRequest(input)),
    heads: async () => guardedInvoke(CHANNELS.ledgerHeads, {}),
    stats: async () => guardedInvoke(CHANNELS.ledgerStats, {}),
  }),

  diagnostics: deepFreeze({
    runtime: async () => guardedInvoke(CHANNELS.diagnosticsRuntime, {}),
    startup: async () => guardedInvoke(CHANNELS.diagnosticsStartup, {}),
    observability: async () => guardedInvoke(CHANNELS.diagnosticsObservability, {}),
    logTail: async (input: unknown) => guardedInvoke(CHANNELS.diagnosticsLogTail, normalizeDiagnosticsLogTailRequest(input)),
    crashContext: async () => guardedInvoke(CHANNELS.diagnosticsCrash, {}),
    export: async (input?: unknown) => guardedInvoke(CHANNELS.diagnosticsExport, normalizeDiagnosticsExportRequest(input)),
    events: deepFreeze({
      subscribe: (callback: EventCallback) => guardedSubscribe(CHANNELS.uiDiagnosticsEvent, callback),
    }),
  }),

  agent: deepFreeze({
    health: async () => guardedInvoke(CHANNELS.agentHealth, {}),
    status: async () => guardedInvoke(CHANNELS.agentStatus, {}),
    start: async (input?: unknown) => guardedInvoke(CHANNELS.agentStart, normalizeAgentControlRequest(input)),
    stop: async (input?: unknown) => guardedInvoke(CHANNELS.agentStop, normalizeAgentControlRequest(input)),
    events: deepFreeze({
      subscribe: (callback: EventCallback) => guardedSubscribe(CHANNELS.uiAgentEvent, callback),
    }),
  }),

  shell: deepFreeze({
    execute: async (input: unknown) => guardedInvoke(ADJUTORIX_SHELL_EXECUTE_CHANNEL, normalizeShellExecuteRequest(input)),
    run: async (input: unknown) => guardedInvoke(ADJUTORIX_SHELL_EXECUTE_CHANNEL, normalizeShellExecuteRequest(input)),
  }),

  command: deepFreeze({
    run: async (input: unknown) => guardedInvoke(ADJUTORIX_SHELL_EXECUTE_CHANNEL, normalizeShellExecuteRequest(input)),
  }),

  commands: deepFreeze({
    run: async (input: unknown) => guardedInvoke(ADJUTORIX_SHELL_EXECUTE_CHANNEL, normalizeShellExecuteRequest(input)),
  }),
} as const;

const exposedApi = createExposedApi(bridge as unknown as Parameters<typeof createExposedApi>[0]);

/* ADJUTORIX_POWER_COMPAT_BRIDGE_BEGIN */
function readPowerBridgeString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const adjutorixPowerBridge = deepFreeze({
  meta: deepFreeze({
    version: 1 as const,
    bridge: "adjutorix.power.compat" as const,
    authority: "governed-preload-existing-ipc" as const,
  }),

  openRepository: async () =>
    bridge.workspace.open({
      schema: 1,
      actor: "renderer",
      source: "ipc",
    }),

  scanWorkspace: async (workspace: string) =>
    bridge.diagnostics.runtime().then((snapshot) => ({
      workspace,
      snapshot,
    })),

  readFile: async (input: unknown) =>
    bridge.workspace.readFile(input),

  saveDraft: async (input: unknown) => {
    const cwd = readPowerBridgeString(input, "workspace");
    return bridge.shell.run({
      command: "printf '%s\\n' ADJUTORIX_SAVE_DRAFT_REQUIRES_GOVERNED_PATCH_GATE",
      ...(cwd ? { cwd } : {}),
    });
  },

  createPlan: async (input: unknown) => {
    const cwd = readPowerBridgeString(input, "workspace");
    return bridge.shell.run({
      command: "printf '%s\\n' ADJUTORIX_CREATE_PLAN_REQUIRES_GOVERNED_PATCH_GATE",
      ...(cwd ? { cwd } : {}),
    });
  },

  runCommand: async (input: unknown) =>
    bridge.shell.run(input),
});
/* ADJUTORIX_POWER_COMPAT_BRIDGE_END */



contextBridge.exposeInMainWorld("adjutorix", deepFreeze(bridge));
contextBridge.exposeInMainWorld("adjutorixApi", exposedApi);
contextBridge.exposeInMainWorld("adjutorixPower", adjutorixPowerBridge);


export type AdjutorixPreloadBridge = typeof bridge;
export type AdjutorixExposedApi = typeof exposedApi;


// ADJUTORIX_NATIVE_PRELOAD_V13
const __adjutorixNativeV13 = {
  marker: "ADJUTORIX_NATIVE_PRELOAD_V13",
  snapshot: () => __adjutorixIpcRendererV13.invoke("adjutorix:v13:snapshot", {}),
  listWorkspace: () => __adjutorixIpcRendererV13.invoke("adjutorix:v13:workspace:list", {}),
  readFile: (payload: any) => __adjutorixIpcRendererV13.invoke("adjutorix:v13:file:read", payload),
  writeFile: (payload: any) => __adjutorixIpcRendererV13.invoke("adjutorix:v13:file:write", payload),
  runCommand: (payload: any) => __adjutorixIpcRendererV13.invoke("adjutorix:v13:command:run", payload),
};

try {
  __adjutorixContextBridgeV13.exposeInMainWorld("adjutorixNativeV13", __adjutorixNativeV13);
} catch {
  // already exposed in this renderer context
}


// ADJUTORIX_NATIVE_EXTERNAL_WORKSPACE_V16_PRELOAD
if (!(globalThis as any).__ADJUTORIX_NATIVE_EXTERNAL_WORKSPACE_V16_PRELOAD__) {
  (globalThis as any).__ADJUTORIX_NATIVE_EXTERNAL_WORKSPACE_V16_PRELOAD__ = true;

  const invokeExternalWorkspaceV16 = (channel: string, payload: unknown = {}) =>
    ipcRenderer.invoke(channel, payload);

  contextBridge.exposeInMainWorld("adjutorixExternalWorkspaceV16", Object.freeze({
    marker: "ADJUTORIX_NATIVE_EXTERNAL_WORKSPACE_V16",
    openFolder: () => invokeExternalWorkspaceV16("adjutorix:v16:dialog:openFolder", {}),
    scan: (payload: unknown = {}) => invokeExternalWorkspaceV16("adjutorix:v16:workspace:scan", payload),
    readFile: (payload: unknown = {}) => invokeExternalWorkspaceV16("adjutorix:v16:file:read", payload),
    writeFile: (payload: unknown = {}) => invokeExternalWorkspaceV16("adjutorix:v16:file:write", payload),
    execute: (payload: unknown = {}) => invokeExternalWorkspaceV16("adjutorix:v16:shell:execute", payload),
  }));
}


// ADJUTORIX_NATIVE_PORTFOLIO_HOST_V18_PRELOAD
try {
  const __portfolioInvokeV18 = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload ?? {});
  contextBridge.exposeInMainWorld("adjutorixPortfolioV18", {
    marker: "ADJUTORIX_NATIVE_PORTFOLIO_HOST_V18",
    state: (payload?: unknown) => __portfolioInvokeV18("adjutorix:v18:state", payload),
    discover: (payload?: unknown) => __portfolioInvokeV18("adjutorix:v18:discover", payload),
    selectRoot: (payload?: unknown) => __portfolioInvokeV18("adjutorix:v18:selectRoot", payload),
    openFolder: (payload?: unknown) => __portfolioInvokeV18("adjutorix:v18:openFolder", payload),
    files: (payload?: unknown) => __portfolioInvokeV18("adjutorix:v18:files", payload),
    read: (payload?: unknown) => __portfolioInvokeV18("adjutorix:v18:read", payload),
    write: (payload?: unknown) => __portfolioInvokeV18("adjutorix:v18:write", payload),
    run: (payload?: unknown) => __portfolioInvokeV18("adjutorix:v18:run", payload),
  });
} catch {}


const operatorKernelApi = {
  createReceipt: (input: unknown) =>
    ipcRenderer.invoke("adjutorix:operatorKernel:createReceipt", input),
  lastHash: (input: unknown) =>
    ipcRenderer.invoke("adjutorix:operatorKernel:lastHash", input),
};


contextBridge.exposeInMainWorld("adjutorixOperatorKernel", operatorKernelApi);

type AdjutorixPreloadNativeKind = "source" | "test" | "config" | "doc" | "asset" | "other";

type AdjutorixPreloadNativeFile = {
  path: string;
  name: string;
  kind: AdjutorixPreloadNativeKind;
  size: number;
};

function adjutorixPreloadNativeKind(filePath: string): AdjutorixPreloadNativeKind {
  const lower = filePath.toLowerCase();

  if (
    lower.includes("/tests/") ||
    lower.startsWith("tests/") ||
    lower.includes("/test/") ||
    lower.includes(".test.") ||
    lower.includes(".spec.")
  ) return "test";

  if (
    lower.endsWith(".json") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".toml") ||
    lower.endsWith(".env") ||
    lower.endsWith(".config.js") ||
    lower.endsWith(".config.ts") ||
    lower.includes("config")
  ) return "config";

  if (
    lower.endsWith(".md") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".rst") ||
    lower.includes("/docs/") ||
    lower.includes("readme")
  ) return "doc";

  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".py") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".css") ||
    lower.endsWith(".html") ||
    lower.endsWith(".swift") ||
    lower.endsWith(".go") ||
    lower.endsWith(".rs")
  ) return "source";

  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".ico") ||
    lower.endsWith(".webp")
  ) return "asset";

  return "other";
}

async function adjutorixPreloadNativeScanWorkspace(workspaceInput: string): Promise<{
  ok: true;
  schema: "adjutorix.preload-native-filesystem.index.v1";
  source: "native-main-filesystem-index";
  workspace: string;
  fileCount: number;
  files: AdjutorixPreloadNativeFile[];
}> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const workspace = nodePath.resolve(workspaceInput);
  const rootStat = await fs.stat(workspace);

  if (!rootStat.isDirectory()) {
    throw new Error(`adjutorix_native_workspace_not_directory:${workspace}`);
  }

  const skip = new Set([
    ".git",
    "node_modules",
    "dist",
    "release",
    ".tmp",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    ".turbo",
    ".cache",
  ]);

  const files: AdjutorixPreloadNativeFile[] = [];
  const maxFiles = 5000;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 20 || files.length >= maxFiles) return;

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (skip.has(entry.name)) continue;

      const absolute = nodePath.join(directory, entry.name);
      const relative = nodePath.relative(workspace, absolute).split(nodePath.sep).join("/");

      if (!relative || relative.startsWith("..") || nodePath.isAbsolute(relative)) continue;

      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
        continue;
      }

      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      if (entry.name.endsWith(".map") || entry.name.endsWith(".log") || entry.name === ".DS_Store") continue;

      let size = 0;
      try {
        size = (await fs.stat(absolute)).size;
      } catch {
        continue;
      }

      files.push({
        path: relative,
        name: entry.name,
        kind: adjutorixPreloadNativeKind(relative),
        size,
      });
    }
  }

  await walk(workspace, 0);

  files.sort((a, b) => {
    const weight = (file: AdjutorixPreloadNativeFile): number => {
      if (file.name.toLowerCase() === "readme.md") return -20;
      if (file.name.toLowerCase() === "package.json") return -10;
      if (file.kind === "source") return 0;
      if (file.kind === "test") return 1;
      if (file.kind === "config") return 2;
      if (file.kind === "doc") return 3;
      if (file.kind === "asset") return 4;
      return 5;
    };

    return weight(a) - weight(b) || a.path.localeCompare(b.path);
  });

  return {
    ok: true,
    schema: "adjutorix.preload-native-filesystem.index.v1",
    source: "native-main-filesystem-index",
    workspace,
    fileCount: files.length,
    files,
  };
}

async function adjutorixPreloadNativeReadFile(request: { workspace: string; path: string }): Promise<{
  ok: true;
  schema: "adjutorix.preload-native-filesystem.read.v1";
  workspace: string;
  path: string;
  content: string;
}> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const workspace = nodePath.resolve(request.workspace);
  const target = nodePath.resolve(workspace, request.path);

  if (target !== workspace && !target.startsWith(workspace + nodePath.sep)) {
    throw new Error("adjutorix_native_read_outside_workspace");
  }

  const content = await fs.readFile(target, "utf8");

  return {
    ok: true,
    schema: "adjutorix.preload-native-filesystem.read.v1",
    workspace,
    path: request.path,
    content: content.slice(0, 160000),
  };
}

contextBridge.exposeInMainWorld("adjutorixNativeFilesystem", {
  scanWorkspace: (workspace: string) => adjutorixPreloadNativeScanWorkspace(workspace),
  readFile: (request: { workspace: string; path: string }) => adjutorixPreloadNativeReadFile(request),
});

const ADJUTORIX_POWER_PACKAGE_NAMES = [
  "@verifrax/originseal",
  "@verifrax/archicustos",
  "@verifrax/kairoclasp",
  "@verifrax/limenward",
  "@verifrax/validexor",
  "@verifrax/attestorium",
  "@verifrax/irrevocull",
  "@verifrax/guillotine",
  "@verifrax/auctoriseal",
  "@verifrax/corpiform",
  "@verifrax/cicullis",
  "@verifrax/verifrax-verify",
  "@verifrax/verifrax-profiles",
  "@verifrax/verifrax-spec",
  "@verifrax/verifrax",
  "@verifrax/sigillarium",
  "@verifrax/verifrax-api",
  "@verifrax/root",
  "@kaaffilm/mk10-pro",
  "@invocorder/recorder",
  "@antimatterium/antimatterium",
];

async function adjutorixPowerPackageInventory(): Promise<{
  ok: true;
  schema: "adjutorix.power-packages.inventory.v1";
  source: "preload-runtime-package-inventory";
  installedCount: number;
  expectedCount: number;
  packages: Array<{
    name: string;
    installed: boolean;
    version?: string;
    packageJsonPath?: string;
  }>;
}> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  const resourceRoot = processWithResources.resourcesPath
    ? nodePath.join(processWithResources.resourcesPath, "app")
    : process.cwd();

  const candidates = [
    resourceRoot,
    process.cwd(),
    nodePath.resolve("."),
  ];

  const rows = [];

  for (const name of ADJUTORIX_POWER_PACKAGE_NAMES) {
    let found: { version: string; packageJsonPath: string } | null = null;

    for (const base of candidates) {
      const packageJsonPath = nodePath.join(base, "node_modules", ...name.split("/"), "package.json");

      try {
        const raw = await fs.readFile(packageJsonPath, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        found = {
          version: parsed.version ?? "unknown",
          packageJsonPath,
        };
        break;
      } catch {
        // try next candidate
      }
    }

    rows.push({
      name,
      installed: Boolean(found),
      version: found?.version,
      packageJsonPath: found?.packageJsonPath,
    });
  }

  return {
    ok: true,
    schema: "adjutorix.power-packages.inventory.v1",
    source: "preload-runtime-package-inventory",
    installedCount: rows.filter((row) => row.installed).length,
    expectedCount: rows.length,
    packages: rows,
  };
}

if (!(globalThis as unknown as { __adjutorixPowerPackagesExposed?: boolean }).__adjutorixPowerPackagesExposed) {
  

async function adjutorixPowerPlaneReadJson(relativePath: string): Promise<unknown> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  const resourceRoot = processWithResources.resourcesPath
    ? nodePath.join(processWithResources.resourcesPath, "app")
    : process.cwd();

  const candidates = [
    nodePath.join(resourceRoot, relativePath),
    nodePath.resolve(relativePath),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, "utf8"));
    } catch {
      // try next candidate
    }
  }

  return null;
}

async function adjutorixPowerPlanePackageDetail(name: string): Promise<{
  name: string;
  installed: boolean;
  version?: string;
  type?: string;
  main?: string | null;
  module?: string | null;
  hasExports: boolean;
  hasBin: boolean;
  packageJsonPath?: string;
}> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  const resourceRoot = processWithResources.resourcesPath
    ? nodePath.join(processWithResources.resourcesPath, "app")
    : process.cwd();

  const candidates = [resourceRoot, process.cwd(), nodePath.resolve(".")];

  for (const base of candidates) {
    const packageJsonPath = nodePath.join(base, "node_modules", ...name.split("/"), "package.json");

    try {
      const raw = await fs.readFile(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw) as {
        version?: string;
        type?: string;
        main?: string;
        module?: string;
        exports?: unknown;
        bin?: unknown;
      };

      return {
        name,
        installed: true,
        version: parsed.version ?? "unknown",
        type: parsed.type ?? "commonjs-or-unspecified",
        main: parsed.main ?? null,
        module: parsed.module ?? null,
        hasExports: Boolean(parsed.exports),
        hasBin: Boolean(parsed.bin),
        packageJsonPath,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    name,
    installed: false,
    hasExports: false,
    hasBin: false,
  };
}

async function adjutorixPowerPlaneInventory(): Promise<{
  ok: true;
  schema: "adjutorix.power-plane.inventory.v1";
  source: "preload-runtime-power-plane";
  installedCount: number;
  expectedCount: number;
  adapters: unknown;
  packages: Array<Awaited<ReturnType<typeof adjutorixPowerPlanePackageDetail>>>;
}> {
  const packageRegistry = await adjutorixPowerPlaneReadJson("configs/runtime/adjutorix_power_packages.json") as
    | { packages?: Array<{ name?: string }> }
    | null;

  const adapters = await adjutorixPowerPlaneReadJson("configs/runtime/adjutorix_power_adapters.json");

  const names =
    packageRegistry?.packages
      ?.map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0) ?? ADJUTORIX_POWER_PACKAGE_NAMES;

  const packages = [];

  for (const name of names) {
    packages.push(await adjutorixPowerPlanePackageDetail(name));
  }

  return {
    ok: true,
    schema: "adjutorix.power-plane.inventory.v1",
    source: "preload-runtime-power-plane",
    installedCount: packages.filter((row) => row.installed).length,
    expectedCount: packages.length,
    adapters,
    packages,
  };
}

contextBridge.exposeInMainWorld("adjutorixPowerPackages", {
    inventory: () => adjutorixPowerPackageInventory(),
    powerPlane: () => adjutorixPowerPlaneInventory(),
  });

  (globalThis as unknown as { __adjutorixPowerPackagesExposed?: boolean }).__adjutorixPowerPackagesExposed = true;
}



type AdjutorixUniversalWorkspaceFile = {
  path: string;
  name: string;
  kind: "source" | "test" | "config" | "doc" | "asset" | "other";
  size: number;
  mtimeMs: number;
};

type AdjutorixUniversalRunInput = {
  workspace?: string;
  command?: string;
  timeoutMs?: number;
};

type AdjutorixUniversalFileInput = {
  workspace?: string;
  path?: string;
  content?: string;
};

async function adjutorixUniversalResolveWorkspace(input: unknown): Promise<string> {
  const nodeFs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error("workspace_path_required");
  }

  const resolved = nodePath.resolve(raw);
  const stat = await nodeFs.stat(resolved);

  if (!stat.isDirectory()) {
    throw new Error(`workspace_not_directory:${resolved}`);
  }

  return resolved;
}

async function adjutorixUniversalResolveFile(workspaceInput: unknown, pathInput: unknown) {
  const nodePath = await import("node:path");
  const root = await adjutorixUniversalResolveWorkspace(workspaceInput);
  const requested = String(pathInput ?? "");

  if (!requested) {
    throw new Error("file_path_required");
  }

  const target = nodePath.resolve(root, requested);
  const relative = nodePath.relative(root, target);

  if (relative.startsWith("..") || nodePath.isAbsolute(relative)) {
    throw new Error("file_outside_workspace_refused");
  }

  return { nodePath, root, target, relative };
}

function adjutorixUniversalKind(path: string): AdjutorixUniversalWorkspaceFile["kind"] {
  const lower = path.toLowerCase();

  if (lower.includes("/test/") || lower.includes("/tests/") || lower.endsWith(".test.ts") || lower.endsWith(".test.tsx") || lower.endsWith(".spec.ts")) {
    return "test";
  }

  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".py") || lower.endsWith(".css") || lower.endsWith(".html") || lower.endsWith(".sql") || lower.endsWith(".sh")) {
    return "source";
  }

  if (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".toml") || lower.endsWith(".env") || lower.endsWith(".cjs") || lower.endsWith(".mjs")) {
    return "config";
  }

  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".rst")) {
    return "doc";
  }

  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".svg") || lower.endsWith(".icns") || lower.endsWith(".woff2")) {
    return "asset";
  }

  return "other";
}

function adjutorixUniversalIgnore(name: string): boolean {
  if (name === ".github") {
    return false;
  }

  if (name.startsWith(".")) {
    return true;
  }

  return new Set([
    "node_modules",
    "dist",
    "release",
    "build",
    "coverage",
    "reports",
    ".next",
    ".turbo",
    ".pytest_cache",
    "__pycache__",
    ".venv",
    "venv",
    ".DS_Store",
    ".adjutorix-release",
    ".adjutorix-backups",
  ]).has(name);
}

contextBridge.exposeInMainWorld("adjutorixUniversalWorkspace", {
  resolveDefaultWorkspace: async () => {
    return {
      envWorkspace: process.env.ADJUTORIX_WORKSPACE ?? "",
      home: process.env.HOME ?? "",
      cwd: process.cwd(),
      source: "adjutorix-universal-workspace",
    };
  },

  scan: async (workspaceInput: string) => {
    const nodeFs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const root = await adjutorixUniversalResolveWorkspace(workspaceInput);
    const files: AdjutorixUniversalWorkspaceFile[] = [];
    const maxFiles = 5000;

    async function walk(relativeDir: string): Promise<void> {
      if (files.length >= maxFiles) {
        return;
      }

      const absoluteDir = nodePath.join(root, relativeDir);
      const entries = await nodeFs.readdir(absoluteDir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) {
          return;
        }

        if (adjutorixUniversalIgnore(entry.name)) {
          continue;
        }

        const relative = relativeDir ? nodePath.join(relativeDir, entry.name) : entry.name;
        const absolute = nodePath.join(root, relative);

        if (entry.isDirectory()) {
          await walk(relative);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const stat = await nodeFs.stat(absolute);
        files.push({
          path: relative,
          name: entry.name,
          kind: adjutorixUniversalKind(relative),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }

    await walk("");

    files.sort((a, b) => {
      const rank = { source: 0, test: 1, config: 2, doc: 3, asset: 4, other: 5 };
      return rank[a.kind] - rank[b.kind] || a.path.localeCompare(b.path);
    });

    return {
      ok: true,
      source: "adjutorix-universal-workspace",
      workspace: root,
      fileCount: files.length,
      truncated: files.length >= maxFiles,
      files,
    };
  },

  readText: async (input: AdjutorixUniversalFileInput) => {
    const nodeFs = await import("node:fs/promises");
    const { root, target, relative } = await adjutorixUniversalResolveFile(input?.workspace, input?.path);
    const stat = await nodeFs.stat(target);

    if (stat.size > 1_500_000) {
      throw new Error(`file_too_large:${relative}`);
    }

    const content = await nodeFs.readFile(target, "utf8");

    return {
      ok: true,
      source: "adjutorix-universal-read",
      workspace: root,
      path: relative,
      content,
    };
  },

  writeText: async (input: AdjutorixUniversalFileInput) => {
    const nodeFs = await import("node:fs/promises");
    const { nodePath, root, target, relative } = await adjutorixUniversalResolveFile(input?.workspace, input?.path);
    const content = String(input?.content ?? "");
    const previous = await nodeFs.readFile(target, "utf8").catch(() => "");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = nodePath.join(root, ".adjutorix-backups", stamp, relative);

    await nodeFs.mkdir(nodePath.dirname(backupPath), { recursive: true });
    await nodeFs.writeFile(backupPath, previous, "utf8");
    await nodeFs.mkdir(nodePath.dirname(target), { recursive: true });
    await nodeFs.writeFile(target, content, "utf8");

    return {
      ok: true,
      source: "adjutorix-universal-write",
      workspace: root,
      path: relative,
      backupPath,
      bytes: new TextEncoder().encode(content).length,
    };
  },

  gitDiff: async (input: AdjutorixUniversalFileInput) => {
    const nodePath = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const root = await adjutorixUniversalResolveWorkspace(input?.workspace);
    const filePath = String(input?.path ?? "");
    const args = ["-C", root, "diff", "--"];

    if (filePath) {
      const target = nodePath.resolve(root, filePath);
      const relative = nodePath.relative(root, target);
      if (relative.startsWith("..") || nodePath.isAbsolute(relative)) {
        throw new Error("diff_path_outside_workspace_refused");
      }
      args.push(relative);
    }

    const result = await run("/usr/bin/git", args, { maxBuffer: 3_000_000 }).catch((error: unknown) => {
      const typed = error as { stdout?: string; stderr?: string; message?: string };
      return {
        stdout: typed.stdout ?? "",
        stderr: typed.stderr ?? typed.message ?? String(error),
      };
    });

    return {
      ok: true,
      source: "adjutorix-universal-git-diff",
      workspace: root,
      output: `${result.stdout ?? ""}${result.stderr ? `\n${result.stderr}` : ""}`.slice(0, 240_000),
    };
  },

  run: async (input: AdjutorixUniversalRunInput) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const root = await adjutorixUniversalResolveWorkspace(input?.workspace);
    const command = String(input?.command ?? "").trim();

    if (!command) {
      throw new Error("command_required");
    }

    const timeout = Math.max(5_000, Math.min(Number(input?.timeoutMs ?? 240_000), 600_000));

    const startedAt = new Date().toISOString();
    const result = await run("/bin/bash", ["-lc", command], {
      cwd: root,
      timeout,
      maxBuffer: 6_000_000,
      env: {
        ...process.env,
        ADJUTORIX_ACTIVE_WORKSPACE: root,
      },
    }).then(
      (success) => ({
        ok: true,
        exitCode: 0,
        stdout: success.stdout ?? "",
        stderr: success.stderr ?? "",
        timedOut: false,
      }),
      (error: unknown) => {
        const typed = error as { code?: number | string; signal?: string; stdout?: string; stderr?: string; killed?: boolean; message?: string };
        return {
          ok: false,
          exitCode: typeof typed.code === "number" ? typed.code : null,
          stdout: typed.stdout ?? "",
          stderr: typed.stderr ?? typed.message ?? String(error),
          timedOut: typed.killed === true || typed.signal === "SIGTERM",
        };
      },
    );

    return {
      ...result,
      source: "adjutorix-universal-command",
      workspace: root,
      command,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  },
});


/* ADJUTORIX_WORKSPACE_OS_BRIDGE_BEGIN */

type AdjutorixOsFileKind = "source" | "test" | "config" | "doc" | "asset" | "lock" | "other";

type AdjutorixOsFile = {
  path: string;
  name: string;
  kind: AdjutorixOsFileKind;
  size: number;
  mtimeMs: number;
};

type AdjutorixOsFileInput = {
  workspace?: string;
  path?: string;
  content?: string;
};

type AdjutorixOsMoveInput = {
  workspace?: string;
  from?: string;
  to?: string;
};

type AdjutorixOsRunInput = {
  workspace?: string;
  command?: string;
  timeoutMs?: number;
};

type AdjutorixOsSearchInput = {
  workspace?: string;
  query?: string;
};

function adjutorixOsKind(path: string): AdjutorixOsFileKind {
  const lower = path.toLowerCase();

  if (lower.endsWith("pnpm-lock.yaml") || lower.endsWith("package-lock.json") || lower.endsWith("yarn.lock")) return "lock";
  if (lower.includes("/test/") || lower.includes("/tests/") || lower.endsWith(".test.ts") || lower.endsWith(".test.tsx") || lower.endsWith(".spec.ts") || lower.endsWith(".spec.tsx")) return "test";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".py") || lower.endsWith(".rs") || lower.endsWith(".go") || lower.endsWith(".swift") || lower.endsWith(".css") || lower.endsWith(".html") || lower.endsWith(".sh") || lower.endsWith(".sql")) return "source";
  if (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".toml") || lower.endsWith(".env") || lower.endsWith(".cjs") || lower.endsWith(".mjs")) return "config";
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".rst")) return "doc";
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".svg") || lower.endsWith(".icns") || lower.endsWith(".woff2")) return "asset";

  return "other";
}

function adjutorixOsIgnore(name: string): boolean {
  if (name === ".github") return false;

  return new Set([
    ".git",
    "node_modules",
    "dist",
    "release",
    "build",
    "coverage",
    ".next",
    ".turbo",
    ".pytest_cache",
    "__pycache__",
    ".venv",
    "venv",
    ".DS_Store",
    ".adjutorix-backups",
    ".adjutorix-trash",
    ".adjutorix-release",
  ]).has(name);
}

async function adjutorixOsResolveWorkspace(input: unknown): Promise<string> {
  const nodeFs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const raw = String(input ?? "").trim();

  if (!raw) throw new Error("workspace_path_required");

  const resolved = nodePath.resolve(raw);
  const stat = await nodeFs.stat(resolved);

  if (!stat.isDirectory()) throw new Error(`workspace_not_directory:${resolved}`);

  return resolved;
}

async function adjutorixOsResolvePath(workspaceInput: unknown, pathInput: unknown) {
  const nodePath = await import("node:path");
  const root = await adjutorixOsResolveWorkspace(workspaceInput);
  const requested = String(pathInput ?? "").trim();

  if (!requested) throw new Error("path_required");

  const target = nodePath.resolve(root, requested);
  const relative = nodePath.relative(root, target);

  if (relative.startsWith("..") || nodePath.isAbsolute(relative)) {
    throw new Error("path_outside_workspace_refused");
  }

  return { nodePath, root, target, relative };
}

async function adjutorixOsScanWorkspace(workspaceInput: unknown) {
  const nodeFs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const root = await adjutorixOsResolveWorkspace(workspaceInput);
  const files: AdjutorixOsFile[] = [];
  const maxFiles = 12000;

  async function walk(relativeDir: string): Promise<void> {
    if (files.length >= maxFiles) return;

    const absoluteDir = nodePath.join(root, relativeDir);
    const entries = await nodeFs.readdir(absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (adjutorixOsIgnore(entry.name)) continue;

      const relative = relativeDir ? nodePath.join(relativeDir, entry.name) : entry.name;
      const absolute = nodePath.join(root, relative);

      if (entry.isDirectory()) {
        await walk(relative);
        continue;
      }

      if (!entry.isFile()) continue;

      const stat = await nodeFs.stat(absolute);

      files.push({
        path: relative.split(nodePath.sep).join("/"),
        name: entry.name,
        kind: adjutorixOsKind(relative),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  await walk("");

  const rank: Record<AdjutorixOsFileKind, number> = {
    source: 0,
    test: 1,
    config: 2,
    doc: 3,
    lock: 4,
    asset: 5,
    other: 6,
  };

  files.sort((a, b) => rank[a.kind] - rank[b.kind] || a.path.localeCompare(b.path));

  return {
    ok: true,
    source: "adjutorix-workspace-os",
    workspace: root,
    fileCount: files.length,
    truncated: files.length >= maxFiles,
    files,
  };
}

contextBridge.exposeInMainWorld("adjutorixWorkspaceOS", {
  defaults: async () => ({
    ok: true,
    source: "adjutorix-workspace-os",
    cwd: process.cwd(),
    home: process.env.HOME ?? "",
    envWorkspace: process.env.ADJUTORIX_WORKSPACE ?? "",
    providers: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      google: Boolean(process.env.GOOGLE_API_KEY),
      local: Boolean(process.env.OLLAMA_HOST || process.env.LMSTUDIO_HOST),
    },
  }),

  scan: async (workspace: string) => adjutorixOsScanWorkspace(workspace),

  readText: async (input: AdjutorixOsFileInput) => {
    const nodeFs = await import("node:fs/promises");
    const { root, target, relative } = await adjutorixOsResolvePath(input?.workspace, input?.path);
    const stat = await nodeFs.stat(target);

    if (stat.size > 2_500_000) throw new Error(`file_too_large:${relative}`);

    return {
      ok: true,
      source: "adjutorix-workspace-os-read",
      workspace: root,
      path: relative,
      content: await nodeFs.readFile(target, "utf8"),
    };
  },

  writeText: async (input: AdjutorixOsFileInput) => {
    const nodeFs = await import("node:fs/promises");
    const { nodePath, root, target, relative } = await adjutorixOsResolvePath(input?.workspace, input?.path);
    const content = String(input?.content ?? "");
    const previous = await nodeFs.readFile(target, "utf8").catch(() => "");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = nodePath.join(root, ".adjutorix-backups", stamp, relative);

    await nodeFs.mkdir(nodePath.dirname(backupPath), { recursive: true });
    await nodeFs.writeFile(backupPath, previous, "utf8");
    await nodeFs.mkdir(nodePath.dirname(target), { recursive: true });
    await nodeFs.writeFile(target, content, "utf8");

    return {
      ok: true,
      source: "adjutorix-workspace-os-write",
      workspace: root,
      path: relative,
      backupPath,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  },

  createFile: async (input: AdjutorixOsFileInput) => {
    const nodeFs = await import("node:fs/promises");
    const { nodePath, root, target, relative } = await adjutorixOsResolvePath(input?.workspace, input?.path);
    await nodeFs.mkdir(nodePath.dirname(target), { recursive: true });
    await nodeFs.writeFile(target, String(input?.content ?? ""), { encoding: "utf8", flag: "wx" });

    return { ok: true, source: "adjutorix-workspace-os-create-file", workspace: root, path: relative };
  },

  makeDirectory: async (input: AdjutorixOsFileInput) => {
    const nodeFs = await import("node:fs/promises");
    const { root, target, relative } = await adjutorixOsResolvePath(input?.workspace, input?.path);
    await nodeFs.mkdir(target, { recursive: true });

    return { ok: true, source: "adjutorix-workspace-os-mkdir", workspace: root, path: relative };
  },

  movePath: async (input: AdjutorixOsMoveInput) => {
    const nodeFs = await import("node:fs/promises");
    const from = await adjutorixOsResolvePath(input?.workspace, input?.from);
    const to = await adjutorixOsResolvePath(input?.workspace, input?.to);

    if (from.root !== to.root) throw new Error("cross_workspace_move_refused");

    await nodeFs.mkdir(to.nodePath.dirname(to.target), { recursive: true });
    await nodeFs.rename(from.target, to.target);

    return { ok: true, source: "adjutorix-workspace-os-move", workspace: from.root, from: from.relative, to: to.relative };
  },

  trashPath: async (input: AdjutorixOsFileInput) => {
    const nodeFs = await import("node:fs/promises");
    const { nodePath, root, target, relative } = await adjutorixOsResolvePath(input?.workspace, input?.path);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const trashPath = nodePath.join(root, ".adjutorix-trash", stamp, relative);

    await nodeFs.mkdir(nodePath.dirname(trashPath), { recursive: true });
    await nodeFs.rename(target, trashPath);

    return { ok: true, source: "adjutorix-workspace-os-trash", workspace: root, path: relative, trashPath };
  },

  searchText: async (input: AdjutorixOsSearchInput) => {
    const nodeFs = await import("node:fs/promises");
    const query = String(input?.query ?? "").trim();
    const lower = query.toLowerCase();

    if (!lower) throw new Error("search_query_required");

    const scan = await adjutorixOsScanWorkspace(input?.workspace);
    const matches: Array<{ path: string; line: number; preview: string }> = [];

    for (const file of scan.files) {
      if (matches.length >= 250) break;
      if (file.size > 750_000) continue;
      if (file.kind === "asset" || file.kind === "lock") continue;

      const { target } = await adjutorixOsResolvePath(scan.workspace, file.path);
      const text = await nodeFs.readFile(target, "utf8").catch(() => "");
      const lines = text.split(/\r?\n/);

      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i]?.toLowerCase().includes(lower)) {
          matches.push({ path: file.path, line: i + 1, preview: String(lines[i]).trim().slice(0, 240) });
          if (matches.length >= 250) break;
        }
      }
    }

    return { ok: true, source: "adjutorix-workspace-os-search", workspace: scan.workspace, query, matches };
  },

  gitStatus: async (workspace: string) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const root = await adjutorixOsResolveWorkspace(workspace);
    const result = await run("/usr/bin/git", ["-C", root, "status", "--short"], { maxBuffer: 2_000_000 }).catch((error: unknown) => {
      const typed = error as { stdout?: string; stderr?: string; message?: string };
      return { stdout: typed.stdout ?? "", stderr: typed.stderr ?? typed.message ?? String(error) };
    });

    return { ok: true, source: "adjutorix-workspace-os-git-status", workspace: root, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  },

  gitDiff: async (input: AdjutorixOsFileInput) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const root = await adjutorixOsResolveWorkspace(input?.workspace);
    const args = ["-C", root, "diff", "--"];
    const filePath = String(input?.path ?? "").trim();

    if (filePath) {
      const resolved = await adjutorixOsResolvePath(root, filePath);
      args.push(resolved.relative);
    }

    const result = await run("/usr/bin/git", args, { maxBuffer: 5_000_000 }).catch((error: unknown) => {
      const typed = error as { stdout?: string; stderr?: string; message?: string };
      return { stdout: typed.stdout ?? "", stderr: typed.stderr ?? typed.message ?? String(error) };
    });

    return { ok: true, source: "adjutorix-workspace-os-git-diff", workspace: root, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(0, 500_000) };
  },

  run: async (input: AdjutorixOsRunInput) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const root = await adjutorixOsResolveWorkspace(input?.workspace);
    const command = String(input?.command ?? "").trim();

    if (!command) throw new Error("command_required");

    const startedAt = new Date().toISOString();
    const timeout = Math.max(5_000, Math.min(Number(input?.timeoutMs ?? 300_000), 900_000));
    const shell = process.env.SHELL || "/bin/bash";

    const result = await run(shell, ["-lc", command], {
      cwd: root,
      timeout,
      maxBuffer: 8_000_000,
      env: {
        ...process.env,
        ADJUTORIX_ACTIVE_WORKSPACE: root,
      },
    }).then(
      (success) => ({
        ok: true,
        exitCode: 0,
        stdout: success.stdout ?? "",
        stderr: success.stderr ?? "",
        timedOut: false,
      }),
      (error: unknown) => {
        const typed = error as { code?: number | string; signal?: string; stdout?: string; stderr?: string; killed?: boolean; message?: string };
        return {
          ok: false,
          exitCode: typeof typed.code === "number" ? typed.code : null,
          stdout: typed.stdout ?? "",
          stderr: typed.stderr ?? typed.message ?? String(error),
          timedOut: typed.killed === true || typed.signal === "SIGTERM",
        };
      },
    );

    return {
      ...result,
      source: "adjutorix-workspace-os-command",
      workspace: root,
      command,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  },
});

/* ADJUTORIX_WORKSPACE_OS_BRIDGE_END */



/**
 * ADJUTORIX_AI_PROVIDER_BRIDGE_V1
 *
 * Real provider bridge:
 * - Ollama/local HTTP generate endpoint
 * - OpenAI-compatible keyed chat completion endpoint
 * - Anthropic keyed messages endpoint
 *
 * This bridge does not claim configured providers are available.
 * Missing keys, missing local daemon, and HTTP failures are returned as runtime facts.
 */

type AdjutorixAiProviderName = "ollama" | "openai" | "anthropic";

interface AdjutorixAiCompleteRequest {
  provider?: AdjutorixAiProviderName;
  prompt: string;
  workspace?: string;
  context?: string;
  instruction?: string;
}

interface AdjutorixAiCompleteResult {
  ok: boolean;
  provider: AdjutorixAiProviderName;
  model: string;
  text: string;
  error?: string;
  elapsedMs: number;
}

interface AdjutorixAiProviderRecord {
  configured: boolean;
  available: boolean;
  provider: AdjutorixAiProviderName;
  model: string;
  endpoint: string;
  reason?: string;
}

interface AdjutorixAiStatusResult {
  ok: boolean;
  providers: Record<AdjutorixAiProviderName, AdjutorixAiProviderRecord>;
}

function adjutorixAiAsRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function adjutorixAiAsString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function adjutorixAiPostJson(
  endpoint: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs = 90000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 1600)}`);
    }

    if (!text.trim()) {
      return {};
    }

    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function adjutorixAiProbe(endpoint: string, timeoutMs = 1200): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, { method: "GET", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function adjutorixAiPrompt(request: AdjutorixAiCompleteRequest): string {
  const workspaceLine = request.workspace ? `Workspace: ${request.workspace}` : "Workspace: not supplied";
  const contextLine = request.context?.trim() ? `\n\nWorkspace context:\n${request.context.trim()}` : "";
  const instructionLine = request.instruction?.trim()
    ? request.instruction.trim()
    : "You are Adjutorix inside a local developer workbench. Return concrete code actions, shell commands, file paths, and risks. Do not pretend a tool ran if it did not run.";

  return `${instructionLine}\n\n${workspaceLine}${contextLine}\n\nUser request:\n${request.prompt}`;
}

async function adjutorixAiStatus(): Promise<AdjutorixAiStatusResult> {
  const ollamaEndpoint = process.env.ADJUTORIX_OLLAMA_ENDPOINT || "http://127.0.0.1:11434";
  const ollamaModel = process.env.ADJUTORIX_OLLAMA_MODEL || "llama3.1";
  const openaiEndpoint = process.env.ADJUTORIX_OPENAI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const openaiModel = process.env.ADJUTORIX_OPENAI_MODEL || "gpt-4o-mini";
  const anthropicEndpoint = process.env.ADJUTORIX_ANTHROPIC_ENDPOINT || "https://api.anthropic.com/v1/messages";
  const anthropicModel = process.env.ADJUTORIX_ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

  const ollamaAvailable = await adjutorixAiProbe(`${ollamaEndpoint.replace(/\/$/, "")}/api/tags`);

  return {
    ok: true,
    providers: {
      ollama: {
        configured: true,
        available: ollamaAvailable,
        provider: "ollama",
        model: ollamaModel,
        endpoint: ollamaEndpoint,
        reason: ollamaAvailable ? undefined : "local Ollama daemon not reachable",
      },
      openai: {
        configured: Boolean(process.env.OPENAI_API_KEY),
        available: Boolean(process.env.OPENAI_API_KEY),
        provider: "openai",
        model: openaiModel,
        endpoint: openaiEndpoint,
        reason: process.env.OPENAI_API_KEY ? undefined : "OPENAI_API_KEY missing",
      },
      anthropic: {
        configured: Boolean(process.env.ANTHROPIC_API_KEY),
        available: Boolean(process.env.ANTHROPIC_API_KEY),
        provider: "anthropic",
        model: anthropicModel,
        endpoint: anthropicEndpoint,
        reason: process.env.ANTHROPIC_API_KEY ? undefined : "ANTHROPIC_API_KEY missing",
      },
    },
  };
}

async function adjutorixAiComplete(request: AdjutorixAiCompleteRequest): Promise<AdjutorixAiCompleteResult> {
  const started = Date.now();
  const provider = request.provider || "ollama";
  const prompt = adjutorixAiPrompt(request);

  try {
    if (provider === "ollama") {
      const endpoint = (process.env.ADJUTORIX_OLLAMA_ENDPOINT || "http://127.0.0.1:11434").replace(/\/$/, "");
      const model = process.env.ADJUTORIX_OLLAMA_MODEL || "llama3.1";
      const payload = { model, prompt, stream: false };
      const json = adjutorixAiAsRecord(await adjutorixAiPostJson(`${endpoint}/api/generate`, { "Content-Type": "application/json" }, payload));
      const text = adjutorixAiAsString(json.response);

      return { ok: true, provider, model, text, elapsedMs: Date.now() - started };
    }

    if (provider === "openai") {
      const key = process.env.OPENAI_API_KEY || "";
      const endpoint = process.env.ADJUTORIX_OPENAI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
      const model = process.env.ADJUTORIX_OPENAI_MODEL || "gpt-4o-mini";

      if (!key) {
        throw new Error("OPENAI_API_KEY missing");
      }

      const payload = {
        model,
        messages: [
          { role: "system", content: "You are Adjutorix, a local software workbench assistant. Be precise and action-oriented." },
          { role: "user", content: prompt },
        ],
      };

      const json = adjutorixAiAsRecord(await adjutorixAiPostJson(endpoint, {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      }, payload));

      const choices = Array.isArray(json.choices) ? json.choices : [];
      const first = adjutorixAiAsRecord(choices[0]);
      const message = adjutorixAiAsRecord(first.message);
      const text = adjutorixAiAsString(message.content);

      return { ok: true, provider, model, text, elapsedMs: Date.now() - started };
    }

    const key = process.env.ANTHROPIC_API_KEY || "";
    const endpoint = process.env.ADJUTORIX_ANTHROPIC_ENDPOINT || "https://api.anthropic.com/v1/messages";
    const model = process.env.ADJUTORIX_ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

    if (!key) {
      throw new Error("ANTHROPIC_API_KEY missing");
    }

    const payload = {
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    };

    const json = adjutorixAiAsRecord(await adjutorixAiPostJson(endpoint, {
      "anthropic-version": "2023-06-01",
      "x-api-key": key,
      "Content-Type": "application/json",
    }, payload));

    const content = Array.isArray(json.content) ? json.content : [];
    const first = adjutorixAiAsRecord(content[0]);
    const text = adjutorixAiAsString(first.text);

    return { ok: true, provider, model, text, elapsedMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      provider,
      model: process.env.ADJUTORIX_AI_MODEL || "not-resolved",
      text: "",
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    };
  }
}

contextBridge.exposeInMainWorld("adjutorixAI", {
  status: adjutorixAiStatus,
  complete: adjutorixAiComplete,
});

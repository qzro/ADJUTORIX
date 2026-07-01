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

type AdjutorixUserWorkbenchFile = {
  path: string;
  name: string;
  kind: "source" | "test" | "config" | "doc" | "asset" | "other";
  size: number;
};

const ADJUTORIX_USER_POWER_PACKAGES = [
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

function adjutorixUserKind(filePath: string): AdjutorixUserWorkbenchFile["kind"] {
  const lower = filePath.toLowerCase();

  if (lower.includes("/tests/") || lower.includes(".test.") || lower.includes(".spec.")) return "test";
  if (lower.endsWith(".json") || lower.endsWith(".yml") || lower.endsWith(".yaml") || lower.endsWith(".toml") || lower.includes("config")) return "config";
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".rst") || lower.includes("/docs/") || lower.includes("readme")) return "doc";
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".svg") || lower.endsWith(".ico") || lower.endsWith(".webp")) return "asset";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".py") ||
    lower.endsWith(".sh") ||
    lower.endsWith(".css") ||
    lower.endsWith(".html") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) return "source";

  return "other";
}

async function adjutorixUserResolveWorkspace(input: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const workspace = nodePath.resolve(input);
  const stat = await fs.stat(workspace);

  if (!stat.isDirectory()) {
    throw new Error(`workspace_not_directory:${workspace}`);
  }

  return workspace;
}

async function adjutorixUserSafeTarget(workspaceInput: string, relativeInput: string): Promise<{ workspace: string; target: string; relative: string }> {
  const nodePath = await import("node:path");

  const workspace = await adjutorixUserResolveWorkspace(workspaceInput);
  const relative = String(relativeInput || "").replaceAll("\\", "/");

  if (!relative || relative.startsWith("/") || relative.includes("../") || relative === "..") {
    throw new Error("unsafe_relative_path");
  }

  const target = nodePath.resolve(workspace, relative);

  if (target !== workspace && !target.startsWith(workspace + nodePath.sep)) {
    throw new Error("path_outside_workspace");
  }

  return { workspace, target, relative };
}

async function adjutorixUserScanWorkspace(workspaceInput: string): Promise<{
  ok: true;
  source: "adjutorix-user-preload-filesystem";
  workspace: string;
  fileCount: number;
  files: AdjutorixUserWorkbenchFile[];
}> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const workspace = await adjutorixUserResolveWorkspace(workspaceInput);
  const skip = new Set([".git", "node_modules", "dist", "release", ".tmp", "__pycache__", ".venv", "venv", ".next", ".turbo", ".cache"]);
  const files: AdjutorixUserWorkbenchFile[] = [];
  const maxFiles = 8000;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 24 || files.length >= maxFiles) return;

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

      if (!relative || relative.startsWith("..")) continue;

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
        kind: adjutorixUserKind(relative),
        size,
      });
    }
  }

  await walk(workspace, 0);

  files.sort((a, b) => {
    const weight = (file: AdjutorixUserWorkbenchFile): number => {
      if (file.name.toLowerCase() === "readme.md") return -30;
      if (file.name.toLowerCase() === "package.json") return -20;
      if (file.path === "packages/adjutorix-app/src/renderer/main.tsx") return -10;
      if (file.kind === "source") return 0;
      if (file.kind === "test") return 1;
      if (file.kind === "config") return 2;
      if (file.kind === "doc") return 3;
      return 4;
    };

    return weight(a) - weight(b) || a.path.localeCompare(b.path);
  });

  return {
    ok: true,
    source: "adjutorix-user-preload-filesystem",
    workspace,
    fileCount: files.length,
    files,
  };
}

async function adjutorixUserReadFile(request: { workspace: string; path: string }): Promise<{
  ok: true;
  workspace: string;
  path: string;
  content: string;
}> {
  const fs = await import("node:fs/promises");
  const safe = await adjutorixUserSafeTarget(request.workspace, request.path);
  const content = await fs.readFile(safe.target, "utf8");

  return {
    ok: true,
    workspace: safe.workspace,
    path: safe.relative,
    content,
  };
}

async function adjutorixUserWriteFile(request: { workspace: string; path: string; content: string }): Promise<{
  ok: true;
  workspace: string;
  path: string;
  backupPath: string | null;
  bytes: number;
}> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const safe = await adjutorixUserSafeTarget(request.workspace, request.path);
  const content = String(request.content ?? "");

  let backupPath: string | null = null;

  try {
    const previous = await fs.readFile(safe.target, "utf8");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = nodePath.join(safe.workspace, ".adjutorix-backups", stamp, safe.relative);
    await fs.mkdir(nodePath.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, previous, "utf8");
  } catch {
    backupPath = null;
  }

  await fs.writeFile(safe.target, content, "utf8");

  return {
    ok: true,
    workspace: safe.workspace,
    path: safe.relative,
    backupPath,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

async function adjutorixUserRunCommand(request: { workspace: string; command: string; timeoutMs?: number }): Promise<{
  ok: boolean;
  workspace: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const childProcess = await import("node:child_process");

  const workspace = await adjutorixUserResolveWorkspace(request.workspace);
  const command = String(request.command || "pwd");
  const timeoutMs = Math.max(1000, Math.min(Number(request.timeoutMs ?? 120000), 300000));

  return await new Promise((resolve) => {
    const child = childProcess.spawn("/bin/zsh", ["-lc", command], {
      cwd: workspace,
      env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        workspace,
        command,
        exitCode: code,
        stdout: stdout.join("").slice(0, 120000),
        stderr: stderr.join("").slice(0, 120000),
        timedOut,
      });
    });
  });
}

async function adjutorixUserGitDiff(request: { workspace: string; path?: string }): Promise<{
  ok: boolean;
  output: string;
}> {
  const rel = request.path ? ` -- ${JSON.stringify(request.path)}` : "";
  const result = await adjutorixUserRunCommand({
    workspace: request.workspace,
    command: `git diff --no-ext-diff --minimal${rel}`,
    timeoutMs: 120000,
  });

  return {
    ok: result.ok || result.stdout.length > 0,
    output: (result.stdout || result.stderr || "No diff.").slice(0, 120000),
  };
}

async function adjutorixUserPowerInventory(): Promise<{
  ok: true;
  source: "adjutorix-user-installed-package-inventory";
  installedCount: number;
  expectedCount: number;
  packages: Array<{ name: string; installed: boolean; version?: string; packageJsonPath?: string }>;
}> {
  const fs = await import("node:fs/promises");
  const nodePath = await import("node:path");

  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  const appRoot = processWithResources.resourcesPath
    ? nodePath.join(processWithResources.resourcesPath, "app")
    : process.cwd();

  const candidates = [appRoot, process.cwd(), nodePath.resolve(".")];

  const packages = [];

  for (const name of ADJUTORIX_USER_POWER_PACKAGES) {
    let row: { name: string; installed: boolean; version?: string; packageJsonPath?: string } = {
      name,
      installed: false,
    };

    for (const base of candidates) {
      const packageJsonPath = nodePath.join(base, "node_modules", ...name.split("/"), "package.json");

      try {
        const parsed = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as { version?: string };
        row = {
          name,
          installed: true,
          version: parsed.version ?? "unknown",
          packageJsonPath,
        };
        break;
      } catch {
        // try next candidate
      }
    }

    packages.push(row);
  }

  return {
    ok: true,
    source: "adjutorix-user-installed-package-inventory",
    installedCount: packages.filter((row) => row.installed).length,
    expectedCount: packages.length,
    packages,
  };
}

if (!(globalThis as unknown as { __adjutorixUserWorkbenchExposed?: boolean }).__adjutorixUserWorkbenchExposed) {
  contextBridge.exposeInMainWorld("adjutorixUserWorkbench", {
    scanWorkspace: (workspace: string) => adjutorixUserScanWorkspace(workspace),
    readFile: (request: { workspace: string; path: string }) => adjutorixUserReadFile(request),
    writeFile: (request: { workspace: string; path: string; content: string }) => adjutorixUserWriteFile(request),
    runCommand: (request: { workspace: string; command: string; timeoutMs?: number }) => adjutorixUserRunCommand(request),
    gitDiff: (request: { workspace: string; path?: string }) => adjutorixUserGitDiff(request),
    powerInventory: () => adjutorixUserPowerInventory(),
  });

  (globalThis as unknown as { __adjutorixUserWorkbenchExposed?: boolean }).__adjutorixUserWorkbenchExposed = true;
}


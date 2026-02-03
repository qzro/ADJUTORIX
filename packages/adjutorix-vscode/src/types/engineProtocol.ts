/**
 * ADJUTORIX ENGINE PROTOCOL (v1)
 * Truth contract: JSON-RPC 2.0, stateless requests, stateful jobs.
 * Engine never lies; controller is dumb; all mutations go through job.run().
 */

/** Single source of truth for protocol version. Controller gate uses protocol === ENGINE_PROTOCOL_VERSION. */
export const ENGINE_PROTOCOL_VERSION = 1;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

export type UnixMs = number;

export type EngineMode = "managed" | "external" | "unknown";

export type ActionName = "check" | "fix" | "verify" | "deploy" | (string & {});

export type JobStatus = "queued" | "running" | "success" | "failed" | "canceled" | "aborted";
export type StepStatus = "queued" | "running" | "success" | "failed" | "skipped";

export type DriverName = "shell" | "node" | "python" | "internal" | (string & {});

export interface EngineIdentity {
  name: "adjutorix-engine";
  version: string;
  fingerprint: string;
  mode: EngineMode;
  pid?: number;
  started_at: UnixMs;
  db_path?: string;
  workspace_root?: string;
}

export interface PingResult {
  ok: true;
  engine: EngineIdentity;
}

export interface CapabilityAction {
  name: ActionName;
  requires_confirm?: boolean;
  enabled?: boolean;
  reason_disabled?: string;
}

export interface EngineCapabilities {
  ok: true;
  engine: EngineIdentity;
  features: {
    chat: boolean;
    actions: boolean;
    streaming: boolean;
  };
  actions: CapabilityAction[];
  drivers: DriverName[];
  limits?: {
    max_concurrent_jobs?: number;
    max_event_payload_bytes?: number;
    max_log_chunk_bytes?: number;
  };
  /**
   * Protocol version. If present, part of the contract; controller gate uses protocol === 1.
   * Do not add ad-hoc fields "for the gate"—either extend this contract or gate on engine.fingerprint/meta.
   */
  protocol?: number;
  /**
   * Implemented RPC method names. If present, part of the contract; controller requires methods.includes("job.run").
   */
  methods?: string[];
}

export interface RunContext {
  workspace_root: string;
  selection?: { files?: string[]; meta?: Record<string, JsonValue> };
  client?: { name: string; version: string; ui_session?: string };
  env?: Record<string, string>;
  meta?: Record<string, JsonValue>;
}

export interface RunParams {
  job_name: string;
  action: ActionName;
  confirm?: boolean;
  context: RunContext;
  strict?: boolean;
}

export interface RunResult {
  ok: true;
  job_id: string;
}

export interface JobGetParams {
  job_id: string;
  include_events?: { tail?: number };
}

export interface JobRow {
  id: string;
  created_at: UnixMs;
  started_at?: UnixMs;
  finished_at?: UnixMs;
  status: JobStatus;
  action: ActionName;
  job_name: string;
  confirm: boolean;
  workspace_root: string;
  context_json?: Record<string, JsonValue>;
  result_json?: Record<string, JsonValue>;
  error?: string;
}

export interface JobGetResult {
  ok: true;
  job: JobRow;
  steps: unknown[];
  events?: unknown[];
}

export interface JobStreamParams {
  job_id: string;
  cursor?: number;
  timeout_ms?: number;
  limit?: number;
}

export interface JobStreamResult {
  ok: true;
  job_id: string;
  events: unknown[];
  next_cursor: number;
  job_status?: JobStatus;
}

export interface CancelParams {
  job_id: string;
}

export interface CancelResult {
  ok: true;
  job_id: string;
  canceled: boolean;
}

/** Methods the engine advertises and implements. Does not include legacy "run". */
export type EngineRpcMethod =
  | "ping"
  | "capabilities"
  | "job.run"
  | "job.status"
  | "job.logs"
  | "job.cancel"
  | "job.list_recent"
  | "patch.propose"
  | "patch.list"
  | "patch.get"
  | "patch.accept"
  | "patch.reject"
  | "patch.apply";

/** Legacy RPC method; fallback only when job.run is not available. Do not advertise. */
export type LegacyRpcMethod = "run";

export type PatchStatus = "proposed" | "accepted" | "rejected" | "applied" | "failed" | "reverted";

export interface PatchSummary {
  patch_id: string;
  job_id: string;
  status: PatchStatus;
  created_at_ms: number;
  summary: string;
}

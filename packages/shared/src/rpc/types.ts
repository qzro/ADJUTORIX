/**
 * Shared RPC request/response types.
 * Used by both VSCode client and local agent.
 */

import { RpcMethod } from "./methods";

/* ===========================
   Base RPC Structures
=========================== */

export interface RpcRequest<T = any> {
  id: string;
  method: RpcMethod;
  params?: T;
  timestamp: number;
}

export interface RpcResponse<T = any> {
  id: string;
  result?: T;
  error?: RpcError;
  timestamp: number;
}

export interface RpcNotification<T = any> {
  method: RpcMethod;
  params?: T;
  timestamp: number;
}

/* ===========================
   Error Structure
=========================== */

export interface RpcError {
  code: string;
  message: string;
  data?: unknown;
  fatal?: boolean;
}

/* ===========================
   Agent Lifecycle
=========================== */

export type AgentState =
  | "SCAN"
  | "PLAN"
  | "PATCH"
  | "VERIFY"
  | "REPORT"
  | "STOP";

export interface AgentStatus {
  state: AgentState;
  jobId: string | null;
  workspace: string | null;
  startedAt: number;
  updatedAt: number;
}

/* ===========================
   Planning
=========================== */

export interface PlanStep {
  id: string;
  description: string;
  files: string[];
  commands: string[];
  expectedResult: string;
}

export interface AgentPlan {
  objective: string;
  steps: PlanStep[];
  rollbackPlan: string;
  riskLevel: "low" | "medium" | "high";
}

/* ===========================
   Patch / Diff
=========================== */

export interface PatchFile {
  path: string;
  diff: string; // unified diff
  reason: string;
}

export interface PatchSet {
  id: string;
  files: PatchFile[];
  createdAt: number;
}

/* ===========================
   Verification
=========================== */

export interface VerifyCommand {
  name: string;
  command: string;
  timeout: number;
}

export interface VerifyResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/* ===========================
   Tool Invocation
=========================== */

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  timeout?: number;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

/* ===========================
   Job Ledger
=========================== */

export interface JobRecord {
  id: string;
  workspace: string;
  state: AgentState;
  plan?: AgentPlan;
  patches?: PatchSet;
  verifyResults?: VerifyResult[];
  startedAt: number;
  finishedAt?: number;
  success?: boolean;
}

/* ===========================
   File / Search
=========================== */

export interface FileSlice {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface SearchResult {
  path: string;
  line: number;
  preview: string;
}

/* ===========================
   Git
=========================== */

export interface GitStatusEntry {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
}

export interface GitCommitInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
}

/* ===========================
   Diagnostics
=========================== */

export interface DiagnosticItem {
  file: string;
  line: number;
  column: number;
  severity: "info" | "warning" | "error";
  message: string;
  source?: string;
}

/* ===========================
   Security
=========================== */

export interface SecretFinding {
  file: string;
  line: number;
  type: string;
  confidence: "low" | "medium" | "high";
}

export interface DependencyAlert {
  package: string;
  version: string;
  vulnerability: string;
  severity: "low" | "medium" | "high" | "critical";
  patchedVersion?: string;
}

/* ===========================
   Deployment
=========================== */

export interface DeployResult {
  environment: "preview" | "production";
  url?: string;
  commit: string;
  startedAt: number;
  finishedAt: number;
  success: boolean;
  logs: string;
}

/* ===========================
   Workspace
=========================== */

export interface WorkspaceInfo {
  name: string;
  path: string;
  language: string;
  toolchain: string;
  checkCommand: string;
  fixCommand: string;
  deployCommand: string;
}

/* ===========================
   Memory / Context
=========================== */

export interface MemorySummary {
  summary: string;
  newFacts: string[];
  newDecisions: string[];
  openTasks: string[];
  risks: string[];
  createdAt: number;
}

/* ===========================
   Generic Helpers
=========================== */

export type Nullable<T> = T | null;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Dict<T = any> = Record<string, T>;

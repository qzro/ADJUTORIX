/**
 * Centralized RPC / Agent error taxonomy.
 * Shared between client, agent, and CLI.
 */

/* ===========================
   Base Error Codes
=========================== */

export enum ErrorCode {
  // Infrastructure
  INTERNAL_ERROR = "INTERNAL_ERROR",
  TIMEOUT = "TIMEOUT",
  NETWORK_ERROR = "NETWORK_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",

  // Planning / State
  INVALID_STATE = "INVALID_STATE",
  INVALID_PLAN = "INVALID_PLAN",
  PLAN_VALIDATION_FAILED = "PLAN_VALIDATION_FAILED",

  // Tooling
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  TOOL_FAILED = "TOOL_FAILED",
  TOOL_TIMEOUT = "TOOL_TIMEOUT",
  TOOL_DENIED = "TOOL_DENIED",

  // Patch / Files
  PATCH_INVALID = "PATCH_INVALID",
  PATCH_CONFLICT = "PATCH_CONFLICT",
  PATCH_LIMIT_EXCEEDED = "PATCH_LIMIT_EXCEEDED",
  PROTECTED_FILE = "PROTECTED_FILE",

  // Verification
  VERIFY_FAILED = "VERIFY_FAILED",
  TEST_FAILED = "TEST_FAILED",
  BUILD_FAILED = "BUILD_FAILED",
  TYPECHECK_FAILED = "TYPECHECK_FAILED",
  LINT_FAILED = "LINT_FAILED",

  // Git
  GIT_ERROR = "GIT_ERROR",
  GIT_DIRTY = "GIT_DIRTY",
  GIT_PUSH_FAILED = "GIT_PUSH_FAILED",

  // Security
  SECRET_DETECTED = "SECRET_DETECTED",
  DEPENDENCY_VULNERABLE = "DEPENDENCY_VULNERABLE",
  NETWORK_BLOCKED = "NETWORK_BLOCKED",

  // Workspace
  WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND",
  WORKSPACE_LOCKED = "WORKSPACE_LOCKED",
  MULTIPLE_WORKSPACES = "MULTIPLE_WORKSPACES",

  // Context / Memory
  CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW",
  MEMORY_WRITE_FAILED = "MEMORY_WRITE_FAILED",

  // Deployment
  DEPLOY_FAILED = "DEPLOY_FAILED",
  ROLLBACK_FAILED = "ROLLBACK_FAILED",
}

/* ===========================
   Error Severity
=========================== */

export type ErrorSeverity = "info" | "warning" | "error" | "fatal";

/* ===========================
   Error Object
=========================== */

export interface AgentError {
  code: ErrorCode;
  message: string;
  severity: ErrorSeverity;
  details?: unknown;
  cause?: Error;
  recoverable: boolean;
  timestamp: number;
}

/* ===========================
   Error Factory
=========================== */

export class ErrorFactory {
  static create(
    code: ErrorCode,
    message: string,
    options?: {
      severity?: ErrorSeverity;
      details?: unknown;
      cause?: Error;
      recoverable?: boolean;
    }
  ): AgentError {
    return {
      code,
      message,
      severity: options?.severity ?? "error",
      details: options?.details,
      cause: options?.cause,
      recoverable: options?.recoverable ?? true,
      timestamp: Date.now(),
    };
  }

  static fatal(
    code: ErrorCode,
    message: string,
    details?: unknown
  ): AgentError {
    return this.create(code, message, {
      severity: "fatal",
      details,
      recoverable: false,
    });
  }

  static warn(
    code: ErrorCode,
    message: string,
    details?: unknown
  ): AgentError {
    return this.create(code, message, {
      severity: "warning",
      details,
      recoverable: true,
    });
  }

  static info(
    code: ErrorCode,
    message: string,
    details?: unknown
  ): AgentError {
    return this.create(code, message, {
      severity: "info",
      details,
      recoverable: true,
    });
  }
}

/* ===========================
   Utilities
=========================== */

export function isFatal(error: AgentError): boolean {
  return error.severity === "fatal" || error.recoverable === false;
}

export function formatError(error: AgentError): string {
  let msg = `[${error.code}] ${error.message}`;

  if (error.details) {
    try {
      msg += ` | details=${JSON.stringify(error.details)}`;
    } catch {
      msg += ` | details=[unserializable]`;
    }
  }

  return msg;
}

export function toPublicError(error: AgentError): {
  code: string;
  message: string;
} {
  return {
    code: error.code,
    message: error.message,
  };
}

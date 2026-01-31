/**
 * Global constants and limits for ADJUTORIX
 * Single source of truth for budgets, caps, and defaults.
 */

/* ================================
   Context / Prompt Budgets
================================ */

export const CONTEXT_LIMITS = {
  MAX_FILES_PER_PROMPT: 6,
  MAX_FILE_SLICE_LINES: 400,
  MAX_CONTEXT_KB: 256,
  MAX_TOKENS_SOFT: 6000,
  MAX_TOKENS_HARD: 8000,
} as const;


/* ================================
   Patch / Diff Limits
================================ */

export const PATCH_LIMITS = {
  MAX_FILES_PER_PATCH: 8,
  MAX_PATCH_SIZE_BYTES: 256 * 1024, // 256 KB
  MAX_HUNKS_PER_FILE: 20,
  REQUIRE_REASON_PER_FILE: true,
} as const;


/* ================================
   Job / Execution Limits
================================ */

export const JOB_LIMITS = {
  MAX_CONCURRENT_JOBS: 1,
  MAX_JOBS_PER_HOUR: 30,
  JOB_TIMEOUT_SECONDS: 1800, // 30 min
  VERIFY_TIMEOUT_SECONDS: 900, // 15 min
} as const;


/* ================================
   Memory / Compaction
================================ */

export const MEMORY_LIMITS = {
  MAX_MEMORY_FILE_KB: 512,
  MAX_DECISIONS_ENTRIES: 1000,
  MAX_KNOWLEDGE_ENTRIES: 500,
  COMPACT_AFTER_JOBS: 5,
} as const;


/* ================================
   Tool Execution
================================ */

export const TOOL_LIMITS = {
  MAX_COMMAND_OUTPUT_KB: 512,
  MAX_COMMAND_RUNTIME_SECONDS: 300,
  MAX_SEARCH_RESULTS: 200,
} as const;


/* ================================
   Security Defaults
================================ */

export const SECURITY_DEFAULTS = {
  NETWORK_ENABLED: false,
  REQUIRE_OVERRIDE_FOR_PROTECTED: true,
  ENABLE_SECRET_SCAN: true,
  ENABLE_DEP_AUDIT: true,
} as const;


/* ================================
   LLM Routing
================================ */

export const MODEL_ROUTING = {
  FAST_MODEL_MAX_TOKENS: 2000,
  STRONG_MODEL_MIN_COMPLEXITY: 0.7,
  MAX_RETRIES: 2,
} as const;


/* ================================
   Agent State Machine
================================ */

export const AGENT_STATES = {
  SCAN: "SCAN",
  PLAN: "PLAN",
  PATCH: "PATCH",
  VERIFY: "VERIFY",
  REPORT: "REPORT",
  STOP: "STOP",
} as const;

export type AgentState = typeof AGENT_STATES[keyof typeof AGENT_STATES];


/* ================================
   Error Codes
================================ */

export const ERROR_CODES = {
  UNKNOWN: "E_UNKNOWN",
  POLICY_VIOLATION: "E_POLICY",
  CONTEXT_OVERFLOW: "E_CONTEXT",
  PATCH_REJECTED: "E_PATCH",
  VERIFY_FAILED: "E_VERIFY",
  TOOL_FAILURE: "E_TOOL",
  TIMEOUT: "E_TIMEOUT",
  LOCKED: "E_LOCKED",
  RECOVERY_FAILED: "E_RECOVERY",
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];


/* ================================
   Defaults
================================ */

export const DEFAULTS = {
  POLICY_VERSION: "1.0.0",
  JOB_LEDGER_DIR: ".agent/jobs",
  MEMORY_DIR: ".agent",
  KNOWLEDGE_DIR: "~/.agent/knowledge",
  LOG_LEVEL: "info",
  RPC_PORT: 17654,
  RPC_HOST: "127.0.0.1",
} as const;

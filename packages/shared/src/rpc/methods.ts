/**
 * Canonical list of RPC method names.
 * Both client and agent MUST use these identifiers.
 */

export const RPC_METHODS = {
  // Core lifecycle
  SCAN: "agent.scan",
  PLAN: "agent.plan",
  PATCH: "agent.patch",
  VERIFY: "agent.verify",
  REPORT: "agent.report",
  STOP: "agent.stop",

  // Tool execution
  RUN_COMMAND: "tool.runCommand",
  SEARCH: "tool.search",
  READ_FILE: "tool.readFile",
  WRITE_FILE: "tool.writeFile",
  WRITE_PATCH: "tool.writePatch",
  LIST_FILES: "tool.listFiles",

  // Git
  GIT_STATUS: "git.status",
  GIT_DIFF: "git.diff",
  GIT_COMMIT: "git.commit",
  GIT_PUSH: "git.push",
  GIT_CHECKOUT: "git.checkout",

  // Code intelligence
  FIND_SYMBOL: "code.findSymbol",
  DEP_GRAPH: "code.dependencyGraph",
  RELATED_FILES: "code.relatedFiles",
  INDEX: "code.reindex",

  // Security
  SECRETS_SCAN: "sec.secretsScan",
  DEP_AUDIT: "sec.dependencyAudit",

  // Deploy
  DEPLOY_PREVIEW: "deploy.preview",
  DEPLOY_PROD: "deploy.prod",
  DEPLOY_ROLLBACK: "deploy.rollback"
} as const;

export type RpcMethod = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

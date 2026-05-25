#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const tag = "adjutorix-operator-surface-spine-v0.6.0";
const expectedSha = "c775ce9f7b193f08bc05e928fe6aea23d4bc59b0";

const reportPath = path.join(root, "reports/current/adjutorix-v060-operator-surface-spine-finality.json");

function fail(code, detail = undefined) {
  const report = {
    ok: false,
    code,
    detail,
    checkedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    fail("GIT_COMMAND_FAILED", { args, stderr: String(error.stderr || error.message || error) });
  }
}

function readRequired(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail("V060_FINALITY_REQUIRED_FILE_MISSING", { file: relativePath });
  }
  return readFileSync(absolutePath, "utf8");
}

const tagSha = git(["rev-list", "-n", "1", tag]);
if (tagSha !== expectedSha) {
  fail("V060_FINALITY_TAG_SHA_MISMATCH", { tag, expectedSha, actualSha: tagSha });
}

const files = {
  policy: "configs/runtime/operator_surface_spine_policy.json",
  app: "packages/adjutorix-app/src/renderer/App.tsx",
  component: "packages/adjutorix-app/src/renderer/components/OperatorSurfaceSpinePanel.tsx",
  contract: "packages/adjutorix-app/tests/renderer/operator_surface_spine_contract.test.ts",
  vitest: "packages/adjutorix-app/vitest.config.mjs",
  productAssert: "scripts/product/assert-operator-surface-spine.mjs",
  readiness: "reports/current/operator-surface-spine-readiness.json",
};

const contents = Object.fromEntries(
  Object.entries(files).map(([key, relativePath]) => [key, readRequired(relativePath)])
);

let policyJson;
try {
  policyJson = JSON.parse(contents.policy);
} catch (error) {
  fail("V060_FINALITY_POLICY_JSON_INVALID", { file: files.policy, error: String(error.message || error) });
}

let readinessJson;
try {
  readinessJson = JSON.parse(contents.readiness);
} catch (error) {
  fail("V060_FINALITY_READINESS_JSON_INVALID", { file: files.readiness, error: String(error.message || error) });
}

const policyText = JSON.stringify(policyJson).toLowerCase();
const componentText = contents.component;
const appText = contents.app;
const contractText = contents.contract;
const vitestText = contents.vitest;
const productAssertText = contents.productAssert;
const readinessText = JSON.stringify(readinessJson).toLowerCase();

const requiredChecks = [
  {
    code: "V060_FINALITY_COMPONENT_NAME_MISSING",
    ok: componentText.includes("OperatorSurfaceSpinePanel"),
  },
  {
    code: "V060_FINALITY_APP_BINDING_MISSING",
    ok: appText.includes("OperatorSurfaceSpinePanel"),
  },
  {
    code: "V060_FINALITY_MISSION_CONTROL_REACHABILITY_MISSING",
    ok: componentText.includes("Mission Control") || componentText.includes("mission control"),
  },
  {
    code: "V060_FINALITY_LIVE_KERNEL_REACHABILITY_MISSING",
    ok: componentText.includes("Live Kernel") || componentText.includes("operator kernel"),
  },
  {
    code: "V060_FINALITY_EXECUTION_RUNWAY_REACHABILITY_MISSING",
    ok: componentText.includes("Execution Runway") || componentText.includes("execution runway"),
  },
  {
    code: "V060_FINALITY_FINALITY_POSTURE_REACHABILITY_MISSING",
    ok: componentText.includes("Finality") || componentText.includes("finality"),
  },
  {
    code: "V060_FINALITY_POLICY_SEMANTICS_MISSING",
    ok:
      policyText.includes("operator") &&
      policyText.includes("surface") &&
      policyText.includes("spine") &&
      policyText.includes("mission") &&
      policyText.includes("kernel") &&
      policyText.includes("execution") &&
      policyText.includes("finality"),
  },
  {
    code: "V060_FINALITY_CONTRACT_SUITE_MISSING",
    ok:
      contractText.includes("operator surface spine contract") &&
      contractText.includes("mission control") &&
      contractText.includes("execution runway") &&
      contractText.includes("finality"),
  },
  {
    code: "V060_FINALITY_VITEST_INCLUDE_MISSING",
    ok: vitestText.includes("operator_surface_spine_contract.test.ts"),
  },
  {
    code: "V060_FINALITY_PRODUCT_ASSERTION_MISSING",
    ok: productAssertText.includes("ADJUTORIX_OPERATOR_SURFACE_SPINE_READINESS=PASS"),
  },
  {
    code: "V060_FINALITY_READINESS_NOT_PASSING",
    ok: readinessText.includes("pass") || readinessText.includes('"ok":true') || readinessText.includes('"ok": true'),
  },
];

const failed = requiredChecks.filter((check) => !check.ok);
if (failed.length > 0) {
  fail("V060_FINALITY_REQUIRED_SURFACE_SPINE_GUARDS_MISSING", failed.map((check) => check.code));
}

try {
  execFileSync("node", ["scripts/product/assert-operator-surface-spine.mjs"], {
    cwd: root,
    stdio: "pipe",
    encoding: "utf8",
  });
} catch (error) {
  fail("V060_FINALITY_PRODUCT_ASSERTION_FAILED", {
    stdout: String(error.stdout || ""),
    stderr: String(error.stderr || error.message || error),
  });
}

const report = {
  ok: true,
  code: "ADJUTORIX_V060_OPERATOR_SURFACE_SPINE_FINALITY_PASS",
  tag,
  tagSha,
  expectedSha,
  lockedSurface: "operator-surface-spine",
  requiredFiles: Object.values(files),
  guardedCapabilities: [
    "mission-control",
    "live-operator-kernel",
    "execution-runway",
    "evidence-finality-posture",
    "single-governed-user-path",
  ],
  checkedAt: new Date().toISOString(),
};

mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

console.log("ADJUTORIX_V060_OPERATOR_SURFACE_SPINE_FINALITY=PASS");
console.log("REPORT=reports/current/adjutorix-v060-operator-surface-spine-finality.json");

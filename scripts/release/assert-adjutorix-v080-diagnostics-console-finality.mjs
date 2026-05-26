#!/usr/bin/env node
import fs from "node:fs";
import cp from "node:child_process";

const BASE_TAG = "adjutorix-operator-diagnostics-console-surface-v0.8.0";
const BASE_SHA = "99b10149d061c744bdcc23f7aab341c5bf1e5f11";

const requiredFiles = [
  "configs/runtime/operator_diagnostics_console_surface_policy.json",
  "packages/adjutorix-app/src/renderer/App.tsx",
  "packages/adjutorix-app/src/renderer/components/OperatorDiagnosticsConsolePanel.tsx",
  "packages/adjutorix-app/tests/renderer/operator_diagnostics_console_surface_contract.test.ts",
  "packages/adjutorix-app/vitest.config.mjs",
  "reports/current/operator-diagnostics-console-surface-readiness.json",
  "scripts/product/assert-operator-diagnostics-console-surface.mjs"
];

const requiredChecks = [
  {
    file: "packages/adjutorix-app/src/renderer/App.tsx",
    phrases: [
      "OperatorDiagnosticsConsolePanel",
      "<OperatorDiagnosticsConsolePanel />"
    ]
  },
  {
    file: "packages/adjutorix-app/src/renderer/components/OperatorDiagnosticsConsolePanel.tsx",
    phrases: [
      "Operator Diagnostics Console",
      "Runtime evidence before runtime trust",
      "runtimeSnapshot",
      "startupReport",
      "observabilityBundle",
      "logTail",
      "crashContext",
      "exportBundle",
      "operatorKernel",
      "last diagnostic result"
    ]
  },
  {
    file: "packages/adjutorix-app/tests/renderer/operator_diagnostics_console_surface_contract.test.ts",
    phrases: [
      "user-visible diagnostics console",
      "every governed diagnostics bridge path",
      "required runtime surface policy",
      "implemented Vitest suite"
    ]
  },
  {
    file: "configs/runtime/operator_diagnostics_console_surface_policy.json",
    phrases: [
      "operator_diagnostics_console",
      "\"required\": true",
      "diagnostics.runtimeSnapshot",
      "diagnostics.startupReport",
      "diagnostics.observabilityBundle",
      "diagnostics.logTail",
      "diagnostics.crashContext",
      "diagnostics.exportBundle",
      "runtime failure evidence"
    ]
  },
  {
    file: "reports/current/operator-diagnostics-console-surface-readiness.json",
    phrases: [
      "adjutorix-operator-diagnostics-console-surface-readiness-v1",
      "operator_diagnostics_console",
      "\"required\": true",
      "runtimeSnapshot",
      "startupReport",
      "observabilityBundle",
      "logTail",
      "crashContext",
      "exportBundle"
    ]
  },
  {
    file: "scripts/product/assert-operator-diagnostics-console-surface.mjs",
    phrases: [
      "ADJUTORIX_OPERATOR_DIAGNOSTICS_CONSOLE_SURFACE_READINESS=PASS",
      "DIAGNOSTICS_CONSOLE_REQUIRED_FILE_MISSING",
      "DIAGNOSTICS_CONSOLE_REQUIRED_PHRASE_MISSING",
      "operator-diagnostics-console-surface-readiness.json"
    ]
  },
  {
    file: "packages/adjutorix-app/vitest.config.mjs",
    phrases: [
      "operator_diagnostics_console_surface_contract.test.ts"
    ]
  }
];

function fail(code, detail = {}) {
  console.error(JSON.stringify({ ok: false, code, detail }, null, 2));
  process.exit(1);
}

function sh(command) {
  return cp.execSync(command, { encoding: "utf8" }).trim();
}

function read(file) {
  if (!fs.existsSync(file)) fail("V080_FINALITY_REQUIRED_FILE_MISSING", { file });
  return fs.readFileSync(file, "utf8");
}

const tagSha = sh(`git rev-list -n 1 ${BASE_TAG}`);
if (tagSha !== BASE_SHA) {
  fail("V080_FINALITY_BASE_TAG_MOVED", { expected: BASE_SHA, actual: tagSha, tag: BASE_TAG });
}

for (const file of requiredFiles) read(file);

for (const check of requiredChecks) {
  const body = read(check.file);
  for (const phrase of check.phrases) {
    if (!body.includes(phrase)) {
      fail("V080_FINALITY_REQUIRED_PHRASE_MISSING", { file: check.file, phrase });
    }
  }
}

const report = {
  ok: true,
  schema: "adjutorix-v080-diagnostics-console-finality-v1",
  finalizedReleaseTag: BASE_TAG,
  finalizedReleaseSha: BASE_SHA,
  surface: "operator_diagnostics_console",
  invariant: "V0.8.0 diagnostics console remains user-visible, policy-required, contract-tested, and bound to governed diagnostics bridge paths.",
  checkedFiles: requiredFiles,
  checkedAt: new Date().toISOString()
};

fs.mkdirSync("reports/current", { recursive: true });
fs.writeFileSync(
  "reports/current/adjutorix-v080-diagnostics-console-finality.json",
  `${JSON.stringify(report, null, 2)}\n`
);

console.log("ADJUTORIX_V080_OPERATOR_DIAGNOSTICS_CONSOLE_FINALITY=PASS");
console.log("REPORT=reports/current/adjutorix-v080-diagnostics-console-finality.json");

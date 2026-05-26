#!/usr/bin/env node
import fs from "node:fs";

const requiredFiles = [
  "configs/runtime/operator_diagnostics_console_surface_policy.json",
  "packages/adjutorix-app/src/renderer/App.tsx",
  "packages/adjutorix-app/src/renderer/components/OperatorDiagnosticsConsolePanel.tsx",
  "packages/adjutorix-app/tests/renderer/operator_diagnostics_console_surface_contract.test.ts",
  "packages/adjutorix-app/vitest.config.mjs"
];

const checks = [
  {
    file: "packages/adjutorix-app/src/renderer/App.tsx",
    phrases: ["OperatorDiagnosticsConsolePanel", "<OperatorDiagnosticsConsolePanel />"]
  },
  {
    file: "packages/adjutorix-app/src/renderer/components/OperatorDiagnosticsConsolePanel.tsx",
    phrases: [
      "Operator Diagnostics Console",
      "runtimeSnapshot",
      "startupReport",
      "observabilityBundle",
      "logTail",
      "crashContext",
      "exportBundle",
      "operatorKernel"
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
      "diagnostics.runtimeSnapshot",
      "diagnostics.startupReport",
      "diagnostics.observabilityBundle",
      "diagnostics.logTail",
      "diagnostics.crashContext",
      "diagnostics.exportBundle"
    ]
  },
  {
    file: "packages/adjutorix-app/vitest.config.mjs",
    phrases: ["operator_diagnostics_console_surface_contract.test.ts"]
  }
];

function fail(code, detail) {
  console.error(JSON.stringify({ ok: false, code, detail }, null, 2));
  process.exit(1);
}

function read(file) {
  if (!fs.existsSync(file)) fail("DIAGNOSTICS_CONSOLE_REQUIRED_FILE_MISSING", { file });
  return fs.readFileSync(file, "utf8");
}

for (const file of requiredFiles) read(file);

for (const check of checks) {
  const body = read(check.file);
  for (const phrase of check.phrases) {
    if (!body.includes(phrase)) {
      fail("DIAGNOSTICS_CONSOLE_REQUIRED_PHRASE_MISSING", { file: check.file, phrase });
    }
  }
}

const report = {
  ok: true,
  schema: "adjutorix-operator-diagnostics-console-surface-readiness-v1",
  surface: "operator_diagnostics_console",
  required: true,
  bridgeFamilies: [
    "runtimeSnapshot",
    "startupReport",
    "observabilityBundle",
    "logTail",
    "crashContext",
    "exportBundle"
  ],
  checkedFiles: requiredFiles,
  checkedAt: new Date().toISOString()
};

fs.mkdirSync("reports/current", { recursive: true });
fs.writeFileSync(
  "reports/current/operator-diagnostics-console-surface-readiness.json",
  `${JSON.stringify(report, null, 2)}\n`
);

console.log("ADJUTORIX_OPERATOR_DIAGNOSTICS_CONSOLE_SURFACE_READINESS=PASS");
console.log("REPORT=reports/current/operator-diagnostics-console-surface-readiness.json");

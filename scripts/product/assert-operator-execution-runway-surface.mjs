#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const checks = [
  {
    file: "packages/adjutorix-app/src/renderer/App.tsx",
    phrases: ["OperatorExecutionRunwayPanel"],
  },
  {
    file: "packages/adjutorix-app/src/renderer/components/OperatorExecutionRunwayPanel.tsx",
    phrases: [
      "ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE",
      "Create runway receipt",
      "Load previous kernel hash",
      "operatorKernel.createReceipt",
      "operatorKernel.lastHash",
      "patch.apply",
      "pnpm run verify",
      "operatorKernelReceiptId",
    ],
  },
  {
    file: "configs/runtime/operator_execution_runway_surface_policy.json",
    phrases: [
      "ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE",
      "anonymous patch apply",
      "release without clean verified main",
    ],
  },
  {
    file: "packages/adjutorix-app/vitest.config.mjs",
    phrases: ["tests/renderer/operator_execution_runway_surface_contract.test.ts"],
  },
];

const failures = [];

for (const check of checks) {
  if (!fs.existsSync(check.file)) {
    failures.push({ code: "MISSING_FILE", file: check.file });
    continue;
  }

  const text = fs.readFileSync(check.file, "utf8");
  for (const phrase of check.phrases) {
    if (!text.includes(phrase)) {
      failures.push({ code: "MISSING_REQUIRED_PHRASE", file: check.file, phrase });
    }
  }
}

const report = {
  ok: failures.length === 0,
  schema: "adjutorix-operator-execution-runway-surface-readiness-v1",
  surface: "ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE",
  checkedAt: new Date().toISOString(),
  failures,
};

const reportPath = "reports/current/operator-execution-runway-surface-readiness.json";
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const historyDir = `reports/history/operator-execution-runway-surface-${report.checkedAt.replace(/[:.]/g, "-")}`;
fs.mkdirSync(historyDir, { recursive: true });
fs.writeFileSync(path.join(historyDir, "readiness.json"), `${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) {
  console.log("ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE_READINESS=FAIL");
  console.log(`REPORT=${reportPath}`);
  for (const failure of failures) console.log(JSON.stringify(failure));
  process.exit(1);
}

console.log("ADJUTORIX_OPERATOR_EXECUTION_RUNWAY_SURFACE_READINESS=PASS");
console.log(`REPORT=${reportPath}`);

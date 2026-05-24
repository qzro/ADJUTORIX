#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

const checks = [
  {
    file: "packages/adjutorix-app/src/renderer/App.tsx",
    phrases: ["OperatorMissionControlPanel"],
  },
  {
    file: "packages/adjutorix-app/src/renderer/components/OperatorMissionControlPanel.tsx",
    phrases: [
      "operator-mission-control-surface",
      "Operator Mission Control",
      "Workspace root",
      "Selected path",
      "Operator intent",
      "Command evidence",
      "previousKernelHash",
      "receiptHash",
      "Apply readiness",
      "createReceipt",
      "lastHash",
      "operatorKernelEvidenceRequired",
    ],
  },
  {
    file: "configs/runtime/operator_mission_control_surface_policy.json",
    phrases: [
      "operator-mission-control-surface",
      "workspaceRoot visible before receipt creation",
      "apply readiness without operator kernel receipt",
    ],
  },
  {
    file: "packages/adjutorix-app/tests/renderer/operator_mission_control_surface_contract.test.ts",
    phrases: [
      "operator mission control surface contract",
      "data-testid=\\\"operator-mission-control-surface\\\"",
      "Create governed operator receipt",
    ],
  },
  {
    file: "packages/adjutorix-app/vitest.config.mjs",
    phrases: ["tests/renderer/operator_mission_control_surface_contract.test.ts"],
  },
];

const failures = [];

for (const check of checks) {
  const fullPath = path.join(repoRoot, check.file);
  if (!fs.existsSync(fullPath)) {
    failures.push({ code: "MISSING_FILE", file: check.file });
    continue;
  }

  const text = fs.readFileSync(fullPath, "utf8");
  for (const phrase of check.phrases) {
    if (!text.includes(phrase)) {
      failures.push({ code: "MISSING_REQUIRED_PHRASE", file: check.file, phrase });
    }
  }
}

const report = {
  ok: failures.length === 0,
  report: "operator-mission-control-surface-readiness",
  version: "0.4.2",
  checkedAt: new Date().toISOString(),
  failures,
};

const reportPath = path.join(repoRoot, "reports/current/operator-mission-control-surface-readiness.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) {
  console.log("ADJUTORIX_OPERATOR_MISSION_CONTROL_SURFACE_READINESS=FAIL");
  console.log(`REPORT=${path.relative(repoRoot, reportPath)}`);
  for (const failure of failures) console.log(JSON.stringify(failure));
  process.exit(1);
}

console.log("ADJUTORIX_OPERATOR_MISSION_CONTROL_SURFACE_READINESS=PASS");
console.log(`REPORT=${path.relative(repoRoot, reportPath)}`);

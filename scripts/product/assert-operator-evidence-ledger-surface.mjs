import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const required = [
  {
    path: "packages/adjutorix-app/src/renderer/components/OperatorEvidenceLedgerPanel.tsx",
    phrases: [
      "operator-evidence-ledger-surface",
      "Operator Evidence Ledger",
      "adjutorix?.ledger",
      "ledger.timeline",
      "ledger.heads",
      "ledger.stats",
      "ledger.entry"
    ]
  },
  {
    path: "packages/adjutorix-app/src/renderer/App.tsx",
    phrases: [
      "OperatorEvidenceLedgerPanel",
      "<OperatorEvidenceLedgerPanel />"
    ]
  },
  {
    path: "configs/runtime/operator_evidence_ledger_surface_policy.json",
    phrases: [
      "operator_evidence_ledger_surface",
      "adjutorix:ledger:timeline",
      "adjutorix:ledger:heads",
      "adjutorix:ledger:stats",
      "adjutorix:ledger:entry",
      "\"mustRemainUserVisible\": true"
    ]
  },
  {
    path: "packages/adjutorix-app/tests/renderer/operator_evidence_ledger_surface_contract.test.ts",
    phrases: [
      "operator evidence ledger surface contract",
      "operator-evidence-ledger-surface",
      "ledger.timeline",
      "ledger.heads",
      "ledger.stats",
      "ledger.entry"
    ]
  },
  {
    path: "packages/adjutorix-app/vitest.config.mjs",
    phrases: [
      "operator_evidence_ledger_surface_contract.test.ts"
    ]
  }
];

const missing = [];

for (const item of required) {
  if (!existsSync(item.path)) {
    missing.push({ file: item.path, reason: "missing_file" });
    continue;
  }

  const content = readFileSync(item.path, "utf8");
  for (const phrase of item.phrases) {
    if (!content.includes(phrase)) {
      missing.push({ file: item.path, phrase });
    }
  }
}

const report = {
  ok: missing.length === 0,
  schema: "adjutorix.operator_evidence_ledger_surface_readiness.v1",
  checkedAt: new Date().toISOString(),
  surface: "operator_evidence_ledger_surface",
  missing
};

mkdirSync("reports/current", { recursive: true });
writeFileSync(
  "reports/current/operator-evidence-ledger-surface-readiness.json",
  `${JSON.stringify(report, null, 2)}\n`
);

const historyDir = `reports/history/operator-evidence-ledger-surface-${report.checkedAt.replaceAll(":", "-").replaceAll(".", "-")}`;
mkdirSync(historyDir, { recursive: true });
writeFileSync(`${historyDir}/readiness.json`, `${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log("ADJUTORIX_OPERATOR_EVIDENCE_LEDGER_SURFACE_READINESS=PASS");
console.log("REPORT=reports/current/operator-evidence-ledger-surface-readiness.json");

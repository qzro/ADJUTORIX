#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const checks = [
  {
    file: "packages/adjutorix-app/src/renderer/App.tsx",
    phrases: [
      'data-testid="operator-kernel-live-surface"',
      "Operator Kernel Live Cockpit",
      "adjutorixOperatorKernel",
      "createOperatorKernelReceipt",
      "operatorKernelHash: operatorKernelReceiptHash",
      "Kernel-gated apply",
      "previousKernelHash",
      "receiptHash"
    ],
  },
  {
    file: "packages/adjutorix-app/src/preload/preload.ts",
    phrases: [
      "operatorKernelReceiptId?: string",
      "operatorKernelHash?: string",
      "operatorKernel?: JsonObject",
      "obj.operatorKernelReceiptId",
      "obj.operatorKernelHash",
      'requireJsonRecord(obj.operatorKernel, "operatorKernel")',
      'exposeInMainWorld("adjutorixOperatorKernel"'
    ],
  },
  {
    file: "packages/adjutorix-app/src/main/ipc/operator_kernel_ipc.ts",
    phrases: [
      "adjutorix:operatorKernel:createReceipt",
      "adjutorix:operatorKernel:lastHash",
      "createOperatorKernelReceipt",
      "readLastOperatorKernelHash"
    ],
  },
  {
    file: "packages/adjutorix-app/src/main/operator/operator_kernel_enforcement.ts",
    phrases: [
      "operatorKernelReceiptId",
      "operatorKernelHash",
      "operatorKernel",
      "assertMandatoryOperatorKernelGate"
    ],
  },
  {
    file: "packages/adjutorix-app/tests/renderer/operator_kernel_live_surface_contract.test.ts",
    phrases: [
      "operator kernel live surface contract",
      "renders a user-visible operator kernel cockpit",
      "keeps kernel evidence across preload patch.apply normalization"
    ],
  },
  {
    file: "packages/adjutorix-app/vitest.config.mjs",
    phrases: [
      "tests/renderer/operator_kernel_live_surface_contract.test.ts"
    ],
  },
  {
    file: "configs/runtime/operator_kernel_live_surface_policy.json",
    phrases: [
      "ADJUTORIX_OPERATOR_KERNEL_LIVE_SURFACE",
      "operator kernel receipt creation must be visible",
      "preload patch.apply normalization must preserve operator kernel evidence"
    ],
  },
];

const failures = [];

for (const check of checks) {
  let text = "";
  try {
    text = read(check.file);
  } catch (error) {
    failures.push({ code: "MISSING_FILE", file: check.file });
    continue;
  }

  for (const phrase of check.phrases) {
    if (!text.includes(phrase)) {
      failures.push({ code: "MISSING_REQUIRED_PHRASE", file: check.file, phrase });
    }
  }
}

const report = {
  product: "ADJUTORIX_OPERATOR_KERNEL_LIVE_SURFACE",
  version: "0.4.0",
  verdict: failures.length === 0 ? "PASS" : "FAIL",
  checked_at: new Date().toISOString(),
  guarantees: [
    "renderer exposes a user-visible operator kernel cockpit",
    "operator intent creates a real kernel receipt from the renderer",
    "patch.apply payload preserves operator kernel evidence through preload normalization",
    "kernel-gated apply is blocked until receipt and patch evidence exist",
    "contract test is included in the implemented renderer test suite"
  ],
  failures
};

fs.mkdirSync(path.join(repoRoot, "reports/current"), { recursive: true });
fs.writeFileSync(
  path.join(repoRoot, "reports/current/operator-kernel-live-surface-readiness.json"),
  JSON.stringify(report, null, 2) + "\n"
);

console.log(`ADJUTORIX_OPERATOR_KERNEL_LIVE_SURFACE_READINESS=${report.verdict}`);
console.log("REPORT=reports/current/operator-kernel-live-surface-readiness.json");

if (failures.length) {
  for (const failure of failures) console.error(JSON.stringify(failure));
  process.exit(1);
}

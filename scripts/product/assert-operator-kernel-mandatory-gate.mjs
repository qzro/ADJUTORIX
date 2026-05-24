#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = process.cwd();

const requiredFiles = [
  "packages/adjutorix-app/src/main/operator/real_operator_kernel.ts",
  "packages/adjutorix-app/src/main/ipc/operator_kernel_ipc.ts",
  "packages/adjutorix-app/src/main/index.ts",
  "packages/adjutorix-app/src/preload/preload.ts",
  "packages/adjutorix-app/tests/renderer/operator_kernel_ipc_contract.test.ts",
  "packages/adjutorix-app/tests/renderer/operator_kernel_mandatory_gate_contract.test.ts",
  "packages/adjutorix-app/vitest.config.mjs",
  "configs/runtime/operator_kernel_policy.json",
  "configs/runtime/operator_kernel_mandatory_gate_policy.json",
  "configs/contracts/operator_kernel_receipt.schema.json"
];

const requiredPhrasesByFile = {
  "packages/adjutorix-app/src/main/operator/real_operator_kernel.ts": [
    "createOperatorKernelReceipt",
    "readLastOperatorKernelHash"
  ],
  "packages/adjutorix-app/src/main/ipc/operator_kernel_ipc.ts": [
    "registerOperatorKernelIpc",
    "adjutorix:operatorKernel:createReceipt",
    "adjutorix:operatorKernel:lastHash",
    "createOperatorKernelReceipt",
    "readLastOperatorKernelHash"
  ],
  "packages/adjutorix-app/src/main/index.ts": [
    "registerOperatorKernelIpc"
  ],
  "packages/adjutorix-app/src/preload/preload.ts": [
    "operatorKernel",
    "createReceipt",
    "lastHash",
    "adjutorix:operatorKernel:createReceipt",
    "adjutorix:operatorKernel:lastHash"
  ],
  "packages/adjutorix-app/tests/renderer/operator_kernel_ipc_contract.test.ts": [
    "operator kernel IPC contract",
    "binds real operator kernel to main IPC and preload",
    "registers operator kernel IPC from main process entry"
  ],
  "packages/adjutorix-app/tests/renderer/operator_kernel_mandatory_gate_contract.test.ts": [
    "operator kernel mandatory gate contract",
    "MANDATORY_OPERATOR_KERNEL_GATE"
  ],
  "packages/adjutorix-app/vitest.config.mjs": [
    "tests/renderer/operator_kernel_ipc_contract.test.ts",
    "tests/renderer/operator_kernel_mandatory_gate_contract.test.ts"
  ],
  "configs/runtime/operator_kernel_mandatory_gate_policy.json": [
    "MANDATORY_OPERATOR_KERNEL_GATE",
    "missing_main_registration",
    "missing_preload_surface",
    "missing_contract_test"
  ]
};

const requiredAnyPhraseByFile = {
  "packages/adjutorix-app/src/main/operator/real_operator_kernel.ts": [
    ["createHash", "sha256", "digest"],
    ["OperatorKernelReceipt", "operator kernel", "kernel receipt"]
  ]
};

const failures = [];

for (const relative of requiredFiles) {
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) {
    failures.push({ code: "MISSING_REQUIRED_FILE", file: relative });
  }
}

for (const [relative, phrases] of Object.entries(requiredPhrasesByFile)) {
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) continue;

  const content = fs.readFileSync(absolute, "utf8");
  for (const phrase of phrases) {
    if (!content.includes(phrase)) {
      failures.push({ code: "MISSING_REQUIRED_PHRASE", file: relative, phrase });
    }
  }
}

for (const [relative, phraseGroups] of Object.entries(requiredAnyPhraseByFile)) {
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) continue;

  const content = fs.readFileSync(absolute, "utf8");
  for (const group of phraseGroups) {
    if (!group.some((phrase) => content.includes(phrase))) {
      failures.push({ code: "MISSING_ANY_REQUIRED_PHRASE", file: relative, anyOf: group });
    }
  }
}

const hashInputFiles = [
  "packages/adjutorix-app/src/main/operator/real_operator_kernel.ts",
  "packages/adjutorix-app/src/main/ipc/operator_kernel_ipc.ts",
  "packages/adjutorix-app/src/main/index.ts",
  "packages/adjutorix-app/src/preload/preload.ts",
  "configs/runtime/operator_kernel_mandatory_gate_policy.json"
];

const perimeterHash = crypto
  .createHash("sha256")
  .update(
    hashInputFiles
      .filter((relative) => fs.existsSync(path.join(repoRoot, relative)))
      .map((relative) => fs.readFileSync(path.join(repoRoot, relative)))
      .join("\n---ADJUTORIX_OPERATOR_KERNEL_GATE_BOUNDARY---\n")
  )
  .digest("hex");

const report = {
  product: "ADJUTORIX_OPERATOR_KERNEL_MANDATORY_GATE",
  verdict: failures.length === 0 ? "PASS" : "FAIL",
  schema: "adjutorix.operator_kernel_mandatory_gate_readiness.v1",
  checked_at: new Date().toISOString(),
  perimeter_hash: perimeterHash,
  guarantees: [
    "real operator kernel source exists",
    "operator kernel IPC registration exists",
    "main process wires operator kernel IPC",
    "preload exposes governed operator kernel bridge",
    "renderer IPC contract test is included",
    "renderer mandatory gate contract test is included",
    "runtime policy declares non-bypassable operator kernel gate"
  ],
  failures
};

fs.mkdirSync(path.join(repoRoot, "reports/current"), { recursive: true });
fs.writeFileSync(
  path.join(repoRoot, "reports/current/operator-kernel-mandatory-gate-readiness.json"),
  `${JSON.stringify(report, null, 2)}\n`
);

console.log(`ADJUTORIX_OPERATOR_KERNEL_MANDATORY_GATE_READINESS=${report.verdict}`);
console.log("REPORT=reports/current/operator-kernel-mandatory-gate-readiness.json");

if (failures.length > 0) {
  for (const failure of failures) console.error(JSON.stringify(failure));
  process.exit(1);
}

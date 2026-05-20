import fs from "node:fs";
import crypto from "node:crypto";

const failures = [];

const requiredFiles = [
  "packages/adjutorix-app/tests/smoke/local_operator_loop.smoke.test.tsx",
  "packages/adjutorix-app/src/renderer/components/LocalOperatorCockpit.tsx"
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push({ code: "MISSING_FILE", file });
}

const smoke = fs.existsSync(requiredFiles[0]) ? fs.readFileSync(requiredFiles[0], "utf8") : "";
const cockpit = fs.existsSync(requiredFiles[1]) ? fs.readFileSync(requiredFiles[1], "utf8") : "";

for (const phrase of [
  "LocalOperatorCockpit",
  "ADJUTORIX_INTENT_PLAN_OBJECT",
  "ADJUTORIX_PATCH_CUSTODY_OBJECT",
  "ADJUTORIX_VERIFICATION_GATE_OBJECT",
  "ADJUTORIX_VERIFY_RECEIPT_OBJECT",
  "ADJUTORIX_APPLY_GATE_OBJECT",
  "ADJUTORIX_APPLY_RECEIPT_OBJECT",
  "ADJUTORIX_ROLLBACK_GATE_OBJECT",
  "ADJUTORIX_ROLLBACK_RECEIPT_OBJECT",
  "ROLLBACK_COMPLETE",
  "apply with receipt",
  "rollback with receipt"
]) {
  if (!smoke.includes(phrase) && !cockpit.includes(phrase)) {
    failures.push({ code: "MISSING_OPERATOR_LOOP_SMOKE_PHRASE", phrase });
  }
}

for (const stale of [
  "open_workspace.smoke.test.tsx",
  "restore_workspace_session.smoke.test.tsx",
  "large_file_guard.smoke.test.tsx"
]) {
  const activePath = `packages/adjutorix-app/tests/smoke/${stale}`;
  if (fs.existsSync(activePath)) failures.push({ code: "STALE_ACTIVE_SMOKE_TEST", file: activePath });
}

const report = {
  product: "ADJUTORIX_OPERATOR_LOOP_SMOKE",
  timestamp: new Date().toISOString(),
  verdict: failures.length === 0 ? "PASS" : "FAIL",
  failures,
  checked_files: requiredFiles
};

fs.mkdirSync("reports/current", { recursive: true });
fs.writeFileSync("reports/current/operator-loop-smoke-readiness.json", JSON.stringify(report, null, 2) + "\n");

const historyDir = `reports/history/operator-loop-smoke-${report.timestamp.replace(/[:.]/g, "-")}`;
fs.mkdirSync(historyDir, { recursive: true });
fs.writeFileSync(`${historyDir}/operator-loop-smoke-readiness.json`, JSON.stringify(report, null, 2) + "\n");

const digest = crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex");
fs.writeFileSync(`${historyDir}/manifest.json`, JSON.stringify({
  product: report.product,
  timestamp: report.timestamp,
  verdict: report.verdict,
  sha256: digest
}, null, 2) + "\n");

console.log(`ADJUTORIX_OPERATOR_LOOP_SMOKE_READINESS=${report.verdict}`);
console.log("REPORT=reports/current/operator-loop-smoke-readiness.json");
console.log(`HISTORY=${historyDir}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(JSON.stringify(failure));
  process.exit(1);
}

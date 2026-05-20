import fs from "node:fs";
import crypto from "node:crypto";

const failures = [];

const requiredFiles = [
  "configs/contracts/verification_gate_object.schema.json",
  "configs/runtime/verification_gate_policy.json",
  "packages/adjutorix-app/src/renderer/components/LocalOperatorCockpit.tsx"
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push({ code: "MISSING_FILE", file });
}

const schemaPath = "configs/contracts/verification_gate_object.schema.json";
const policyPath = "configs/runtime/verification_gate_policy.json";
const cockpitPath = "packages/adjutorix-app/src/renderer/components/LocalOperatorCockpit.tsx";

const schema = fs.existsSync(schemaPath) ? JSON.parse(fs.readFileSync(schemaPath, "utf8")) : null;
const policy = fs.existsSync(policyPath) ? JSON.parse(fs.readFileSync(policyPath, "utf8")) : null;
const cockpit = fs.existsSync(cockpitPath) ? fs.readFileSync(cockpitPath, "utf8") : "";

if (schema?.properties?.object_type?.const !== "ADJUTORIX_VERIFICATION_GATE_OBJECT") {
  failures.push({ code: "SCHEMA_BAD_OBJECT_TYPE" });
}

for (const required of [
  "verification_gate_id",
  "plan_id",
  "patch_custody_id",
  "workspace_root",
  "custody",
  "basis",
  "inputs",
  "required_checks",
  "gate_state",
  "execution",
  "result",
  "apply_gate",
  "evidence"
]) {
  if (!schema?.required?.includes(required)) failures.push({ code: "SCHEMA_MISSING_REQUIRED", required });
}

if (policy?.policy_type !== "ADJUTORIX_VERIFICATION_GATE_POLICY") {
  failures.push({ code: "POLICY_BAD_TYPE" });
}

for (const gate of [
  "requires_plan_object",
  "requires_patch_custody_object",
  "requires_workspace_bound",
  "verification_gate_may_not_mutate_files",
  "verification_gate_may_not_apply_patch",
  "verify_execution_requires_operator_trigger",
  "verify_execution_requires_runtime",
  "verify_execution_requires_diagnostics",
  "verify_receipt_required",
  "apply_locked_until_verify_pass",
  "apply_requires_apply_receipt",
  "rollback_requires_apply_receipt"
]) {
  if (policy?.[gate] !== true) failures.push({ code: "POLICY_GATE_NOT_TRUE", gate });
}

for (const phrase of [
  "type VerificationGateObject",
  "createVerificationGateObject",
  "validateVerificationGateObject",
  "ADJUTORIX_VERIFICATION_GATE_OBJECT",
  "verification.gate.created",
  "verification_gate_receipt",
  "Verification Gate object",
  "Create verification gate",
  "may_mutate_files: false",
  "may_apply_patch: false",
  "apply_unlocked: false"
]) {
  if (!cockpit.includes(phrase)) failures.push({ code: "COCKPIT_MISSING_VERIFICATION_GATE_PHRASE", phrase });
}

const report = {
  product: "ADJUTORIX_PATCH_CUSTODY_TO_VERIFICATION_GATE",
  timestamp: new Date().toISOString(),
  verdict: failures.length === 0 ? "PASS" : "FAIL",
  failures,
  checked_files: requiredFiles
};

fs.mkdirSync("reports/current", { recursive: true });
fs.writeFileSync("reports/current/verification-gate-object-readiness.json", JSON.stringify(report, null, 2) + "\n");

const historyDir = `reports/history/verification-gate-object-${report.timestamp.replace(/[:.]/g, "-")}`;
fs.mkdirSync(historyDir, { recursive: true });
fs.writeFileSync(`${historyDir}/verification-gate-object-readiness.json`, JSON.stringify(report, null, 2) + "\n");

const digest = crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex");
fs.writeFileSync(`${historyDir}/manifest.json`, JSON.stringify({
  product: report.product,
  timestamp: report.timestamp,
  verdict: report.verdict,
  sha256: digest
}, null, 2) + "\n");

console.log(`ADJUTORIX_VERIFICATION_GATE_OBJECT_READINESS=${report.verdict}`);
console.log("REPORT=reports/current/verification-gate-object-readiness.json");
console.log(`HISTORY=${historyDir}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(JSON.stringify(failure));
  process.exit(1);
}

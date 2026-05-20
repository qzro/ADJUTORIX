import fs from "node:fs";
import crypto from "node:crypto";

const failures = [];

const requiredFiles = [
  "packages/adjutorix-app/src/renderer/components/LocalOperatorCockpit.tsx",
  "packages/adjutorix-app/src/renderer/main.tsx"
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push({ code: "MISSING_FILE", file });
}

const componentPath = "packages/adjutorix-app/src/renderer/components/LocalOperatorCockpit.tsx";
const mainPath = "packages/adjutorix-app/src/renderer/main.tsx";

const component = fs.existsSync(componentPath) ? fs.readFileSync(componentPath, "utf8") : "";
const main = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, "utf8") : "";

const requiredComponentPhrases = [
  "Local governed coding control plane",
  "ADJUTORIX Operator Cockpit",
  "Repository custody",
  "Trust classification",
  "Intent capture",
  "Plan object",
  "Patch object",
  "Verification object",
  "Apply gate",
  "Rollback receipt",
  "Evidence timeline",
  "Advanced surfaces"
];

for (const phrase of requiredComponentPhrases) {
  if (!component.includes(phrase)) failures.push({ code: "MISSING_COCKPIT_PHRASE", phrase });
}

if (!main.includes('import LocalOperatorCockpit from "./components/LocalOperatorCockpit";')) {
  failures.push({ code: "MAIN_MISSING_COCKPIT_IMPORT" });
}

if (!main.includes("<LocalOperatorCockpit />")) {
  failures.push({ code: "MAIN_NOT_ROOT_MOUNTED_TO_COCKPIT" });
}

const forbiddenMainPhrases = [
  "<ShellApp />",
  "OverviewSurface",
  "Command Surface",
  "Open Command Surface"
];

for (const phrase of forbiddenMainPhrases) {
  if (main.includes(phrase)) failures.push({ code: "FORBIDDEN_OLD_ROOT_PHRASE", phrase });
}

const report = {
  product: "ADJUTORIX_LOCAL_OPERATOR_COCKPIT",
  timestamp: new Date().toISOString(),
  verdict: failures.length === 0 ? "PASS" : "FAIL",
  failures,
  checked_files: requiredFiles,
  root_mount: "LocalOperatorCockpit",
  required_component_phrases: requiredComponentPhrases
};

fs.mkdirSync("reports/current", { recursive: true });
fs.writeFileSync("reports/current/local-operator-cockpit-readiness.json", JSON.stringify(report, null, 2) + "\n");

const historyDir = `reports/history/local-operator-cockpit-${report.timestamp.replace(/[:.]/g, "-")}`;
fs.mkdirSync(historyDir, { recursive: true });
fs.writeFileSync(`${historyDir}/local-operator-cockpit-readiness.json`, JSON.stringify(report, null, 2) + "\n");

const digest = crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex");
fs.writeFileSync(`${historyDir}/manifest.json`, JSON.stringify({
  product: report.product,
  timestamp: report.timestamp,
  verdict: report.verdict,
  sha256: digest
}, null, 2) + "\n");

console.log(`ADJUTORIX_LOCAL_OPERATOR_COCKPIT_READINESS=${report.verdict}`);
console.log("REPORT=reports/current/local-operator-cockpit-readiness.json");
console.log(`HISTORY=${historyDir}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(JSON.stringify(failure));
  process.exit(1);
}

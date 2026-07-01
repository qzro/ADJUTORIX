#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const packageRegistryPath = path.resolve("configs/runtime/adjutorix_power_packages.json");
const adapterRegistryPath = path.resolve("configs/runtime/adjutorix_power_adapters.json");
const appPackagePath = path.resolve("packages/adjutorix-app/package.json");

const packageRegistry = JSON.parse(fs.readFileSync(packageRegistryPath, "utf8"));
const adapterRegistry = JSON.parse(fs.readFileSync(adapterRegistryPath, "utf8"));
const appPackage = JSON.parse(fs.readFileSync(appPackagePath, "utf8"));

const deps = appPackage.dependencies || {};
const rows = [];
const failures = [];

const packageNames = packageRegistry.packages.map((entry) => entry.name);
const adapterNames = adapterRegistry.groups.flatMap((group) => group.packages);

for (const name of packageNames) {
  if (!adapterNames.includes(name)) failures.push(`${name}:missing_from_adapter_registry`);
}

for (const name of adapterNames) {
  if (!packageNames.includes(name)) failures.push(`${name}:missing_from_package_registry`);
  if (!deps[name]) failures.push(`${name}:missing_from_adjutorix_app_dependencies`);

  const packageJsonPath = path.resolve("packages/adjutorix-app/node_modules", ...name.split("/"), "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    failures.push(`${name}:missing_runtime_package_json`);
    continue;
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  rows.push({
    name,
    version: pkg.version || "unknown",
    type: pkg.type || "commonjs-or-unspecified",
    main: pkg.main || null,
    module: pkg.module || null,
    exports: Boolean(pkg.exports),
    bin: Boolean(pkg.bin),
    packageJsonPath,
  });
}

if (failures.length > 0) {
  console.error("ADJUTORIX_POWER_PLANE_VERIFY_FAILED=true");
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

const report = {
  schema: "adjutorix.power-plane.verify-report.v1",
  status: "ADJUTORIX_POWER_PLANE_VERIFY_OK",
  packageCount: rows.length,
  generatedAt: new Date().toISOString(),
  packages: rows,
};

fs.mkdirSync("reports/current", { recursive: true });
fs.writeFileSync("reports/current/adjutorix-power-plane-verify.json", JSON.stringify(report, null, 2) + "\n");

console.log(JSON.stringify({
  status: report.status,
  packageCount: report.packageCount,
  report: "reports/current/adjutorix-power-plane-verify.json",
}, null, 2));
NODE

echo "ADJUTORIX_POWER_PLANE_VERIFY_OK=true"

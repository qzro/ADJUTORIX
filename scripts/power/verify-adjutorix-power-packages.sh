#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const registryPath = path.resolve("configs/runtime/adjutorix_power_packages.json");
const appPackagePath = path.resolve("packages/adjutorix-app/package.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const appPackage = JSON.parse(fs.readFileSync(appPackagePath, "utf8"));

const deps = appPackage.dependencies || {};
const failures = [];

for (const entry of registry.packages) {
  const name = entry.name;
  if (!deps[name]) {
    failures.push(`${name}:missing_from_packages/adjutorix-app/package.json`);
    continue;
  }

  const packageDir = path.resolve("packages/adjutorix-app/node_modules", ...name.split("/"));
  const packageJson = path.join(packageDir, "package.json");

  if (!fs.existsSync(packageJson)) {
    failures.push(`${name}:missing_node_modules_package_json`);
    continue;
  }

  const installed = JSON.parse(fs.readFileSync(packageJson, "utf8"));
  console.log(`${name}@${installed.version}`);
}

if (failures.length > 0) {
  console.error("ADJUTORIX_POWER_PACKAGE_VERIFY_FAILED");
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log("ADJUTORIX_POWER_PACKAGES_VERIFY_OK=true");
NODE

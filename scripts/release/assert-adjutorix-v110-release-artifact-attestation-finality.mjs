#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PROTECTED_TAG = "adjutorix-operator-release-artifact-attestation-perimeter-v1.1.0";
const PROTECTED_SHA = "acf9d87105c853098b9b6d11d8f55c6b748755fb";

const PREVIOUS_TAG = "adjutorix-operator-release-integrity-perimeter-v1.0.0";
const PREVIOUS_SHA = "9fa783f0c728d2ef2869935257b2292aa426b28b";

const REQUIRED_ASSETS = [
  "Adjutorix-0.1.0-arm64.dmg",
  "Adjutorix-0.1.0-arm64.dmg.blockmap",
  "builder-effective-config.yaml",
];

const REQUIRED_FILES = [
  ".github/workflows/adjutorix-v110-operator-release-artifact-attestation.yml",
  "configs/runtime/operator_release_artifact_attestation_policy.json",
  "reports/current/operator-release-artifact-attestation-readiness.json",
  "scripts/product/assert-operator-release-artifact-attestation.mjs",
];

const REPORT = "reports/current/adjutorix-v110-release-artifact-attestation-finality.json";

function fail(code, detail) {
  console.error(JSON.stringify({ ok: false, code, detail }, null, 2));
  process.exit(1);
}

function read(path) {
  if (!existsSync(path)) fail("ADJUTORIX_V110_FINALITY_FILE_MISSING", { path });
  return readFileSync(path, "utf8");
}

function parseJson(path) {
  try {
    return JSON.parse(read(path));
  } catch (error) {
    fail("ADJUTORIX_V110_FINALITY_JSON_INVALID", {
      path,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function flatten(value, out = []) {
  if (value === null || value === undefined) return out;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
    return out;
  }

  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.push(String(key));
      flatten(item, out);
    }
  }

  return out;
}

function requireText(label, text, token) {
  if (!text.includes(token)) {
    fail("ADJUTORIX_V110_FINALITY_TOKEN_MISSING", { label, token });
  }
}

function requireOne(label, text, tokens) {
  if (!tokens.some((token) => text.includes(token))) {
    fail("ADJUTORIX_V110_FINALITY_ANY_TOKEN_MISSING", { label, tokens });
  }
}

const protectedSha = git(["rev-list", "-n", "1", PROTECTED_TAG]);
if (protectedSha !== PROTECTED_SHA) {
  fail("ADJUTORIX_V110_FINALITY_PROTECTED_TAG_MOVED", {
    tag: PROTECTED_TAG,
    expected: PROTECTED_SHA,
    actual: protectedSha,
  });
}

const previousSha = git(["rev-list", "-n", "1", PREVIOUS_TAG]);
if (previousSha !== PREVIOUS_SHA) {
  fail("ADJUTORIX_V110_FINALITY_PREVIOUS_TAG_MOVED", {
    tag: PREVIOUS_TAG,
    expected: PREVIOUS_SHA,
    actual: previousSha,
  });
}

for (const path of REQUIRED_FILES) {
  if (!existsSync(path)) fail("ADJUTORIX_V110_FINALITY_REQUIRED_FILE_MISSING", { path });
}

const policyPath = "configs/runtime/operator_release_artifact_attestation_policy.json";
const policy = parseJson(policyPath);
const policyText = JSON.stringify(policy, null, 2);
const policyFlat = flatten(policy).join("\n").toLowerCase();

for (const token of ["release", "artifact", "attestation"]) {
  if (!policyFlat.includes(token)) {
    fail("ADJUTORIX_V110_FINALITY_POLICY_STRUCTURAL_TOKEN_MISSING", {
      path: policyPath,
      token,
    });
  }
}

requireOne("artifact-attestation-policy-anchor", policyText, [
  "release_integrity",
  "operator_release_integrity",
  "operator_release_integrity_perimeter",
  PREVIOUS_TAG,
  PREVIOUS_SHA,
]);

const readinessPath = "reports/current/operator-release-artifact-attestation-readiness.json";
const readiness = parseJson(readinessPath);
const readinessText = JSON.stringify(readiness, null, 2);

if (readiness.ok !== true) {
  fail("ADJUTORIX_V110_FINALITY_READINESS_NOT_OK", {
    path: readinessPath,
    ok: readiness.ok,
  });
}

const productAssertionPath = "scripts/product/assert-operator-release-artifact-attestation.mjs";
const productAssertion = read(productAssertionPath);

const v110WorkflowPath = ".github/workflows/adjutorix-v110-operator-release-artifact-attestation.yml";
const v110Workflow = read(v110WorkflowPath);

const evidenceText = [
  policyText,
  readinessText,
  productAssertion,
  v110Workflow,
].join("\n");

for (const asset of REQUIRED_ASSETS) {
  if (!evidenceText.includes(asset)) {
    fail("ADJUTORIX_V110_FINALITY_REQUIRED_ASSET_EVIDENCE_MISSING", {
      asset,
      checked: [policyPath, readinessPath, productAssertionPath, v110WorkflowPath],
    });
  }
}

requireOne("artifact-attestation-previous-tag-or-sha-evidence", evidenceText, [
  PREVIOUS_TAG,
  PREVIOUS_SHA,
  "9fa783f",
  "release_integrity",
]);

requireText("artifact-attestation-workflow", v110Workflow, "assert-operator-release-artifact-attestation.mjs");

const report = {
  ok: true,
  code: "ADJUTORIX_V110_RELEASE_ARTIFACT_ATTESTATION_FINALITY",
  protectedTag: PROTECTED_TAG,
  protectedSha: PROTECTED_SHA,
  previousTag: PREVIOUS_TAG,
  previousSha: PREVIOUS_SHA,
  requiredAssets: REQUIRED_ASSETS,
  requiredFiles: REQUIRED_FILES,
  checks: {
    protectedTagImmutableByGit: true,
    previousTagImmutableByGit: true,
    policyStructural: true,
    readinessOk: true,
    requiredAssetsPresentInEvidenceSurface: true,
    productAssertionPresent: true,
    workflowPresent: true,
  },
  explicitNonAttestations: [
    "latest-mac.yml auto-update manifest trust is not attested",
    "Developer ID signing is not attested",
    "macOS notarization is not attested",
    "customer distribution trust is not attested",
  ],
};

writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

console.log("ADJUTORIX_V110_RELEASE_ARTIFACT_ATTESTATION_FINALITY=PASS");
console.log(`REPORT=${REPORT}`);

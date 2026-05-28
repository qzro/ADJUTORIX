#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();

const POLICY_PATH = "configs/runtime/operator_release_artifact_attestation_policy.json";
const PREVIOUS_POLICY_PATH = "configs/runtime/operator_release_integrity_perimeter_policy.json";
const PREVIOUS_REPORT_PATH = "reports/current/operator-release-integrity-perimeter-readiness.json";
const PREVIOUS_WORKFLOW_PATH = ".github/workflows/adjutorix-v100-operator-release-integrity-perimeter.yml";
const REPORT_PATH = "reports/current/operator-release-artifact-attestation-readiness.json";
const TMP_DIR = ".tmp/operator-release-artifact-attestation";

function fail(code, detail = {}) {
  console.error(JSON.stringify({ ok: false, code, detail }, null, 2));
  process.exit(1);
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_COMMAND_FAILED", {
      command: [cmd, ...args].join(" "),
      stdout: error.stdout?.toString?.() || "",
      stderr: error.stderr?.toString?.() || "",
      message: error.message
    });
  }
}

function readText(path) {
  if (!existsSync(path)) fail("ADJUTORIX_ARTIFACT_ATTESTATION_FILE_MISSING", { path });
  return readFileSync(path, "utf8");
}

function readJson(path) {
  const body = readText(path);
  try {
    return JSON.parse(body);
  } catch (error) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_JSON_INVALID", { path, message: error.message });
  }
}

function sha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function normalized(value) {
  return JSON.stringify(value ?? "").toLowerCase().replace(/_/g, "-");
}

function assertPreviousPerimeterStillPresent() {
  const previousPolicy = readJson(PREVIOUS_POLICY_PATH);
  const previousReport = readJson(PREVIOUS_REPORT_PATH);
  const previousWorkflow = readText(PREVIOUS_WORKFLOW_PATH);

  const policyText = normalized(previousPolicy);
  const reportText = normalized(previousReport);

  if (!policyText.includes("release") || !policyText.includes("integrity") || !policyText.includes("perimeter")) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_PREVIOUS_POLICY_NOT_RELEASE_INTEGRITY_PERIMETER", {
      path: PREVIOUS_POLICY_PATH
    });
  }

  if (previousReport.ok !== true) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_PREVIOUS_REPORT_NOT_OK", {
      path: PREVIOUS_REPORT_PATH,
      ok: previousReport.ok
    });
  }

  if (!reportText.includes("release") || !reportText.includes("integrity")) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_PREVIOUS_REPORT_NOT_RELEASE_INTEGRITY_SHAPED", {
      path: PREVIOUS_REPORT_PATH
    });
  }

  if (!previousWorkflow.includes("assert-operator-release-integrity-perimeter.mjs")) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_PREVIOUS_WORKFLOW_ASSERTION_MISSING", {
      path: PREVIOUS_WORKFLOW_PATH
    });
  }
}

const policy = readJson(POLICY_PATH);

if (policy.perimeter !== "operator-release-artifact-attestation") {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_POLICY_PERIMETER_INVALID", { actual: policy.perimeter });
}

if (policy.required !== true) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_POLICY_NOT_REQUIRED", { actual: policy.required });
}

if (policy.attestation?.download_release_assets !== true) fail("ADJUTORIX_ARTIFACT_ATTESTATION_DOWNLOAD_NOT_REQUIRED");
if (policy.attestation?.record_asset_sha256 !== true) fail("ADJUTORIX_ARTIFACT_ATTESTATION_SHA256_NOT_REQUIRED");
if (policy.attestation?.record_asset_size_bytes !== true) fail("ADJUTORIX_ARTIFACT_ATTESTATION_SIZE_NOT_REQUIRED");

if (policy.distribution_trust?.current_customer_distribution_trust !== false) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_TRUST_MUST_NOT_BE_CLAIMED");
}

if (policy.distribution_trust?.auto_update_manifest_attested !== false) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_AUTO_UPDATE_MANIFEST_MUST_NOT_BE_ATTESTED");
}

const base = policy.base_release || {};
const tag = base.tag;
const expectedCommit = base.expected_commit;
const requiredReleaseName = base.required_release_name;

if (!tag || !expectedCommit || !requiredReleaseName) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_BASE_RELEASE_INCOMPLETE", { base_release: base });
}

const actualTagCommit = sh("git", ["rev-list", "-n", "1", tag]);
if (actualTagCommit !== expectedCommit) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_BASE_TAG_SHA_MISMATCH", {
    tag,
    expectedCommit,
    actualTagCommit
  });
}

assertPreviousPerimeterStillPresent();

const repo = process.env.GITHUB_REPOSITORY || "qzro/ADJUTORIX";

const release = JSON.parse(sh("gh", [
  "release",
  "view",
  tag,
  "-R",
  repo,
  "--json",
  "tagName,name,isDraft,isPrerelease,targetCommitish,url,assets"
]));

if (release.tagName !== tag) fail("ADJUTORIX_ARTIFACT_ATTESTATION_RELEASE_TAG_MISMATCH", { expected: tag, actual: release.tagName });
if (release.name !== requiredReleaseName) fail("ADJUTORIX_ARTIFACT_ATTESTATION_RELEASE_NAME_MISMATCH", { expected: requiredReleaseName, actual: release.name });
if (release.isDraft !== false) fail("ADJUTORIX_ARTIFACT_ATTESTATION_RELEASE_IS_DRAFT", { tag });
if (release.isPrerelease !== false) fail("ADJUTORIX_ARTIFACT_ATTESTATION_RELEASE_IS_PRERELEASE", { tag });
if (release.targetCommitish !== "main") fail("ADJUTORIX_ARTIFACT_ATTESTATION_RELEASE_TARGET_INVALID", { actual: release.targetCommitish });

const assets = Array.isArray(release.assets) ? release.assets : [];
const assetNames = assets.map((asset) => asset.name).sort();

if (assetNames.length < 3) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_ASSET_COUNT_TOO_LOW", { assetNames });
}

const requiredAssets = policy.required_assets;
if (!Array.isArray(requiredAssets) || requiredAssets.length === 0) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_REQUIRED_ASSETS_POLICY_EMPTY");
}

const matchedRequirements = requiredAssets.map((requirement) => {
  const regex = new RegExp(requirement.namePattern);
  const matches = assetNames.filter((name) => regex.test(name));

  if (requirement.required === true && matches.length === 0) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_REQUIRED_ASSET_MISSING", {
      kind: requirement.kind,
      namePattern: requirement.namePattern,
      assetNames
    });
  }

  return {
    kind: requirement.kind,
    namePattern: requirement.namePattern,
    matches
  };
});

const notAttestedAssets = Array.isArray(policy.not_attested_assets) ? policy.not_attested_assets : [];
const notAttestedEvidence = notAttestedAssets.map((entry) => {
  const regex = new RegExp(entry.namePattern);
  const present = assetNames.filter((name) => regex.test(name));

  if (present.length > 0) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_NOT_ATTESTED_ASSET_PRESENT_UNEXPECTEDLY", {
      kind: entry.kind,
      namePattern: entry.namePattern,
      present
    });
  }

  return {
    kind: entry.kind,
    namePattern: entry.namePattern,
    present: false,
    reason: entry.reason
  };
});

rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

sh("gh", ["release", "download", tag, "-R", repo, "--dir", TMP_DIR, "--clobber"]);

const downloaded = readdirSync(TMP_DIR).filter((name) => !name.startsWith(".")).sort();

for (const expected of assetNames) {
  if (!downloaded.includes(expected)) {
    fail("ADJUTORIX_ARTIFACT_ATTESTATION_ASSET_DOWNLOAD_MISSING", {
      expected,
      downloaded
    });
  }
}

const downloadedEvidence = downloaded.map((name) => {
  const path = join(TMP_DIR, name);
  const stat = statSync(path);

  if (!stat.isFile()) fail("ADJUTORIX_ARTIFACT_ATTESTATION_DOWNLOAD_NOT_FILE", { name });
  if (stat.size <= 0) fail("ADJUTORIX_ARTIFACT_ATTESTATION_DOWNLOAD_EMPTY", { name });

  return {
    name,
    size_bytes: stat.size,
    sha256: sha256(path)
  };
});

const dmg = downloadedEvidence.find((asset) => /^Adjutorix-.*-arm64\.dmg$/.test(asset.name));
const blockmap = downloadedEvidence.find((asset) => /^Adjutorix-.*-arm64\.dmg\.blockmap$/.test(asset.name));
const builderConfig = downloadedEvidence.find((asset) => /^builder-effective-config\.yaml$/.test(asset.name));
const latestMac = downloadedEvidence.find((asset) => /^latest-mac\.yml$/.test(asset.name));

if (!dmg || !blockmap || !builderConfig) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_REQUIRED_DOWNLOAD_CLASS_MISSING", {
    dmg: Boolean(dmg),
    blockmap: Boolean(blockmap),
    builderConfig: Boolean(builderConfig)
  });
}

if (latestMac) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_LATEST_MAC_PRESENT_BUT_POLICY_SAYS_NOT_ATTESTED", {
    latestMac: latestMac.name
  });
}

const builderBody = readFileSync(join(TMP_DIR, builderConfig.name), "utf8");
if (!builderBody.includes("appId") && !builderBody.includes("productName") && !builderBody.includes("directories")) {
  fail("ADJUTORIX_ARTIFACT_ATTESTATION_BUILDER_CONFIG_NOT_CONFIG_SHAPED", {
    builderConfig: builderConfig.name
  });
}

const report = {
  ok: true,
  schema: "adjutorix.operator_release_artifact_attestation_report.v1",
  perimeter: "operator-release-artifact-attestation",
  generated_at: new Date().toISOString(),
  repo,
  base_release: {
    tag,
    expected_commit: expectedCommit,
    actual_tag_commit: actualTagCommit,
    release_name: release.name,
    release_url: release.url,
    target_commitish: release.targetCommitish,
    is_draft: release.isDraft,
    is_prerelease: release.isPrerelease
  },
  previous_perimeter: {
    policy_path: PREVIOUS_POLICY_PATH,
    report_path: PREVIOUS_REPORT_PATH,
    workflow_path: PREVIOUS_WORKFLOW_PATH,
    report_used_as_commit_authority: false
  },
  required_assets: matchedRequirements,
  not_attested_assets: notAttestedEvidence,
  downloaded_assets: downloadedEvidence,
  distribution_trust: {
    repository_release_integrity_attested: true,
    release_artifact_download_attested: true,
    asset_sha256_attested: true,
    electron_builder_config_attested: true,
    auto_update_manifest_attested: false,
    macos_customer_distribution_trust_attested: false,
    code_signing_status: "not_attested",
    notarization_status: "not_attested",
    reason: policy.distribution_trust?.reason
  }
};

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

console.log("ADJUTORIX_OPERATOR_RELEASE_ARTIFACT_ATTESTATION_READINESS=PASS");
console.log(`REPORT=${REPORT_PATH}`);

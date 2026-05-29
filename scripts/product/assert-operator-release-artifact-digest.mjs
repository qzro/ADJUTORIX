#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const POLICY_PATH = "configs/runtime/operator_release_artifact_digest_policy.json";
const REPORT_PATH = "reports/current/operator-release-artifact-digest-readiness.json";

function fail(code, detail = {}) {
  console.error(JSON.stringify({ ok: false, code, detail }, null, 2));
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("ADJUTORIX_ARTIFACT_DIGEST_JSON_READ_FAILED", {
      path: filePath,
      message: String(error?.message || error),
    });
  }
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      ...options,
    }).trim();
  } catch (error) {
    fail("ADJUTORIX_ARTIFACT_DIGEST_COMMAND_FAILED", {
      command,
      args,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
      message: String(error?.message || error),
    });
  }
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail("ADJUTORIX_ARTIFACT_DIGEST_POLICY_FIELD_INVALID", { label });
  }
}

function assertStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    fail("ADJUTORIX_ARTIFACT_DIGEST_POLICY_ARRAY_INVALID", { label });
  }
}

const policy = readJson(POLICY_PATH);

if (policy.schema !== "adjutorix-operator-release-artifact-digest-policy-v1") {
  fail("ADJUTORIX_ARTIFACT_DIGEST_POLICY_SCHEMA_INVALID", { schema: policy.schema });
}

if (policy.perimeter !== "operator-release-artifact-digest") {
  fail("ADJUTORIX_ARTIFACT_DIGEST_POLICY_PERIMETER_INVALID", { perimeter: policy.perimeter });
}

if (policy.digestAlgorithm !== "sha256") {
  fail("ADJUTORIX_ARTIFACT_DIGEST_ALGORITHM_INVALID", {
    digestAlgorithm: policy.digestAlgorithm,
  });
}

for (const key of [
  "repository",
  "protectedReleaseTag",
  "protectedReleaseCommit",
  "protectedFinalityTag",
  "protectedFinalityCommit",
]) {
  assertString(policy[key], key);
}

assertStringArray(policy.requiredAssets, "requiredAssets");
assertStringArray(policy.forbiddenAssets, "forbiddenAssets");

const protectedReleaseSha = run("git", ["rev-list", "-n", "1", policy.protectedReleaseTag]);
if (protectedReleaseSha !== policy.protectedReleaseCommit) {
  fail("ADJUTORIX_ARTIFACT_DIGEST_PROTECTED_RELEASE_TAG_DRIFT", {
    tag: policy.protectedReleaseTag,
    expected: policy.protectedReleaseCommit,
    actual: protectedReleaseSha,
  });
}

const protectedFinalitySha = run("git", ["rev-list", "-n", "1", policy.protectedFinalityTag]);
if (protectedFinalitySha !== policy.protectedFinalityCommit) {
  fail("ADJUTORIX_ARTIFACT_DIGEST_PROTECTED_FINALITY_TAG_DRIFT", {
    tag: policy.protectedFinalityTag,
    expected: policy.protectedFinalityCommit,
    actual: protectedFinalitySha,
  });
}

const release = JSON.parse(
  run("gh", [
    "release",
    "view",
    policy.protectedReleaseTag,
    "-R",
    policy.repository,
    "--json",
    "tagName,name,isDraft,isPrerelease,targetCommitish,url,assets",
  ])
);

if (release.tagName !== policy.protectedReleaseTag) {
  fail("ADJUTORIX_ARTIFACT_DIGEST_RELEASE_TAG_MISMATCH", {
    expected: policy.protectedReleaseTag,
    actual: release.tagName,
  });
}

if (release.isDraft || release.isPrerelease) {
  fail("ADJUTORIX_ARTIFACT_DIGEST_RELEASE_NOT_PUBLIC_FINAL", {
    isDraft: release.isDraft,
    isPrerelease: release.isPrerelease,
  });
}

const releaseAssetNames = [...release.assets.map((asset) => asset.name)].sort();
const requiredAssetNames = [...policy.requiredAssets].sort();

for (const forbidden of policy.forbiddenAssets) {
  if (releaseAssetNames.includes(forbidden)) {
    fail("ADJUTORIX_ARTIFACT_DIGEST_FORBIDDEN_ASSET_PRESENT", { forbidden });
  }
}

for (const required of requiredAssetNames) {
  if (!releaseAssetNames.includes(required)) {
    fail("ADJUTORIX_ARTIFACT_DIGEST_REQUIRED_ASSET_MISSING", {
      required,
      releaseAssetNames,
    });
  }
}

const unexpected = releaseAssetNames.filter((name) => !requiredAssetNames.includes(name));
if (unexpected.length > 0) {
  fail("ADJUTORIX_ARTIFACT_DIGEST_UNEXPECTED_ASSET_PRESENT", {
    unexpected,
    releaseAssetNames,
    requiredAssetNames,
  });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adjutorix-release-digest-"));

try {
  run("gh", [
    "release",
    "download",
    policy.protectedReleaseTag,
    "-R",
    policy.repository,
    "-D",
    tmpDir,
  ]);

  const digests = {};

  for (const assetName of requiredAssetNames) {
    const assetPath = path.join(tmpDir, assetName);

    if (!fs.existsSync(assetPath)) {
      fail("ADJUTORIX_ARTIFACT_DIGEST_DOWNLOADED_ASSET_MISSING", { assetName });
    }

    const stat = fs.statSync(assetPath);
    if (!stat.isFile() || stat.size <= 0) {
      fail("ADJUTORIX_ARTIFACT_DIGEST_ASSET_EMPTY_OR_NOT_FILE", {
        assetName,
        size: stat.size,
      });
    }

    const digest = sha256(assetPath);
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      fail("ADJUTORIX_ARTIFACT_DIGEST_INVALID_SHA256", { assetName, digest });
    }

    digests[assetName] = {
      algorithm: "sha256",
      sha256: digest,
      bytes: stat.size,
    };
  }

  const uniqueDigests = new Set(Object.values(digests).map((entry) => entry.sha256));
  if (uniqueDigests.size !== Object.keys(digests).length) {
    fail("ADJUTORIX_ARTIFACT_DIGEST_COLLISION_OR_DUPLICATE", { digests });
  }

  const report = {
    ok: true,
    schema: "adjutorix-operator-release-artifact-digest-readiness-v1",
    perimeter: "operator-release-artifact-digest",
    repository: policy.repository,
    protectedReleaseTag: policy.protectedReleaseTag,
    protectedReleaseCommit: policy.protectedReleaseCommit,
    protectedFinalityTag: policy.protectedFinalityTag,
    protectedFinalityCommit: policy.protectedFinalityCommit,
    releaseUrl: release.url,
    releaseName: release.name,
    releaseDraft: release.isDraft,
    releasePrerelease: release.isPrerelease,
    assetCount: releaseAssetNames.length,
    requiredAssets: requiredAssetNames,
    forbiddenAssetsAbsent: policy.forbiddenAssets,
    digestAlgorithm: "sha256",
    digests,
    invariants: {
      protectedReleaseTagImmutableByGit: true,
      protectedFinalityTagImmutableByGit: true,
      releaseAssetsDownloadedFromGitHub: true,
      requiredAssetSetExact: true,
      forbiddenAssetsAbsent: true,
      byteIdentityCaptured: true,
    },
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log("ADJUTORIX_OPERATOR_RELEASE_ARTIFACT_DIGEST_READINESS=PASS");
  console.log(`REPORT=${REPORT_PATH}`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

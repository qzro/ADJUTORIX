import fs from "node:fs";
import { execFileSync } from "node:child_process";

const GH_REPO = "qzro/ADJUTORIX";

const FINALIZED_TAG = "adjutorix-operator-release-artifact-digest-perimeter-v1.2.0";
const FINALIZED_SHA = "f38f780e37ad55551444a02326ab59b9f2ffc0aa";

const REPORT_PATH = "reports/current/adjutorix-v120-release-artifact-digest-finality.json";

const REQUIRED_FILES = {
  policy: "configs/runtime/operator_release_artifact_digest_policy.json",
  productAssertion: "scripts/product/assert-operator-release-artifact-digest.mjs",
  workflow: ".github/workflows/adjutorix-v120-operator-release-artifact-digest.yml",
  readinessReport: "reports/current/operator-release-artifact-digest-readiness.json",
};

const REQUIRED_ASSETS = [
  {
    name: "Adjutorix-0.1.0-arm64.dmg",
    digest: "sha256:3a262c1ed4289b1e7f637517ddfc9dc02af971d171728cc0d13eab4cd60126a0",
    size: 117350119,
  },
  {
    name: "Adjutorix-0.1.0-arm64.dmg.blockmap",
    digest: "sha256:b131c3bc3ccda34af6a87a0cc53e06b7fe92dfb2c49099c3afacb21da7d763d0",
    size: 123874,
  },
  {
    name: "builder-effective-config.yaml",
    digest: "sha256:e9b895583154534c34632ac410541d5bc5786ca1f43dcb075368ff9807b21040",
    size: 337,
  },
];

function writeReport(report) {
  fs.mkdirSync("reports/current", { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

function fail(code, detail = {}) {
  writeReport({
    ok: false,
    schema: "adjutorix.v120_release_artifact_digest_finality.v1",
    code,
    detail,
    finalizedTag: FINALIZED_TAG,
    finalizedCommit: FINALIZED_SHA,
  });

  console.error(JSON.stringify({ ok: false, code, detail }, null, 2));
  process.exit(1);
}

function readText(path, label) {
  if (!fs.existsSync(path)) {
    fail("ADJUTORIX_V120_DIGEST_FINALITY_FILE_MISSING", { label, path });
  }

  return fs.readFileSync(path, "utf8");
}

function readJson(path, label) {
  const text = readText(path, label);

  try {
    return JSON.parse(text);
  } catch (error) {
    fail("ADJUTORIX_V120_DIGEST_FINALITY_JSON_INVALID", {
      label,
      path,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    fail("ADJUTORIX_V120_DIGEST_FINALITY_COMMAND_FAILED", {
      command,
      args,
      stdout: error?.stdout?.toString?.() ?? "",
      stderr: error?.stderr?.toString?.() ?? "",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function requireTextIncludes(path, label, tokens) {
  const text = readText(path, label);

  for (const token of tokens) {
    if (!text.includes(token)) {
      fail("ADJUTORIX_V120_DIGEST_FINALITY_TOKEN_MISSING", {
        label,
        path,
        token,
      });
    }
  }

  return text;
}

const tagSha = run("git", ["rev-list", "-n", "1", FINALIZED_TAG]);
if (tagSha !== FINALIZED_SHA) {
  fail("ADJUTORIX_V120_DIGEST_FINALITY_TAG_SHA_MISMATCH", {
    tag: FINALIZED_TAG,
    expected: FINALIZED_SHA,
    actual: tagSha,
  });
}

const release = JSON.parse(
  run("gh", [
    "release",
    "view",
    FINALIZED_TAG,
    "-R",
    GH_REPO,
    "--json",
    "tagName,name,isDraft,isPrerelease,targetCommitish,url,assets",
  ]),
);

if (release.tagName !== FINALIZED_TAG) {
  fail("ADJUTORIX_V120_DIGEST_FINALITY_RELEASE_TAG_MISMATCH", {
    expected: FINALIZED_TAG,
    actual: release.tagName,
  });
}

if (release.isDraft !== false || release.isPrerelease !== false) {
  fail("ADJUTORIX_V120_DIGEST_FINALITY_RELEASE_NOT_CANONICAL", {
    isDraft: release.isDraft,
    isPrerelease: release.isPrerelease,
  });
}

if (release.targetCommitish !== "main") {
  fail("ADJUTORIX_V120_DIGEST_FINALITY_RELEASE_TARGET_INVALID", {
    expected: "main",
    actual: release.targetCommitish,
  });
}

const assets = Array.isArray(release.assets) ? release.assets : [];
if (assets.length !== REQUIRED_ASSETS.length) {
  fail("ADJUTORIX_V120_DIGEST_FINALITY_ASSET_COUNT_INVALID", {
    expected: REQUIRED_ASSETS.length,
    actual: assets.length,
    assetNames: assets.map((asset) => asset.name),
  });
}

for (const expected of REQUIRED_ASSETS) {
  const actual = assets.find((asset) => asset.name === expected.name);

  if (!actual) {
    fail("ADJUTORIX_V120_DIGEST_FINALITY_ASSET_MISSING", {
      expected: expected.name,
      actualAssetNames: assets.map((asset) => asset.name),
    });
  }

  if (actual.digest !== expected.digest) {
    fail("ADJUTORIX_V120_DIGEST_FINALITY_ASSET_DIGEST_MISMATCH", {
      asset: expected.name,
      expected: expected.digest,
      actual: actual.digest,
    });
  }

  if (actual.size !== expected.size) {
    fail("ADJUTORIX_V120_DIGEST_FINALITY_ASSET_SIZE_MISMATCH", {
      asset: expected.name,
      expected: expected.size,
      actual: actual.size,
    });
  }

  if (actual.state !== "uploaded") {
    fail("ADJUTORIX_V120_DIGEST_FINALITY_ASSET_STATE_INVALID", {
      asset: expected.name,
      expected: "uploaded",
      actual: actual.state,
    });
  }
}

const policyText = JSON.stringify(readJson(REQUIRED_FILES.policy, "artifact-digest-policy"));
if (!policyText.includes("digest") && !policyText.includes("sha256")) {
  fail("ADJUTORIX_V120_DIGEST_FINALITY_POLICY_NOT_DIGEST_BOUND", {
    path: REQUIRED_FILES.policy,
  });
}

requireTextIncludes(REQUIRED_FILES.productAssertion, "artifact-digest-product-assertion", [
  "ADJUTORIX_OPERATOR_RELEASE_ARTIFACT_DIGEST_READINESS",
  "sha256",
  "digest",
]);

requireTextIncludes(REQUIRED_FILES.workflow, "artifact-digest-workflow", [
  "assert-operator-release-artifact-digest.mjs",
]);

const readiness = readJson(REQUIRED_FILES.readinessReport, "artifact-digest-readiness-report");
if (readiness.ok !== true) {
  fail("ADJUTORIX_V120_DIGEST_FINALITY_READINESS_NOT_OK", {
    path: REQUIRED_FILES.readinessReport,
    ok: readiness.ok,
  });
}

const readinessText = JSON.stringify(readiness);
for (const expected of REQUIRED_ASSETS) {
  if (!readinessText.includes(expected.name)) {
    fail("ADJUTORIX_V120_DIGEST_FINALITY_READINESS_ASSET_NAME_MISSING", {
      path: REQUIRED_FILES.readinessReport,
      asset: expected.name,
    });
  }
}

const report = {
  ok: true,
  schema: "adjutorix.v120_release_artifact_digest_finality.v1",
  finalizedTag: FINALIZED_TAG,
  finalizedCommit: FINALIZED_SHA,
  release: {
    tagName: release.tagName,
    name: release.name,
    targetCommitish: release.targetCommitish,
    isDraft: release.isDraft,
    isPrerelease: release.isPrerelease,
    url: release.url,
  },
  finalizedAssets: REQUIRED_ASSETS.map((expected) => {
    const actual = assets.find((asset) => asset.name === expected.name);

    return {
      name: expected.name,
      digest: actual.digest,
      size: actual.size,
      state: actual.state,
      url: actual.url,
    };
  }),
  localEvidence: REQUIRED_FILES,
  readinessReportScope: "structural-only; canonical SHA-256 digest evidence is GitHub release asset metadata and this finality report",
};

writeReport(report);

console.log("ADJUTORIX_V120_RELEASE_ARTIFACT_DIGEST_FINALITY=PASS");
console.log(`REPORT=${REPORT_PATH}`);

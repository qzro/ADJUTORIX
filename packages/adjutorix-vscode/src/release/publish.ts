import { execSync } from "child_process";
import * as path from "path";

/**
 * Optional publisher for VS Code Marketplace.
 * Disabled by default. Requires manual token.
 */

const ROOT = path.resolve(__dirname, "../../");

function run(cmd: string) {
  console.log(`[publish] ${cmd}`);
  execSync(cmd, {
    stdio: "inherit",
    cwd: ROOT,
    env: process.env,
  });
}

function checkToken() {
  if (!process.env.VSCE_PAT) {
    console.error("Missing VSCE_PAT environment variable.");
    console.error("Export your personal access token first.");
    process.exit(1);
  }
}

function main() {
  try {
    console.log("== Adjutorix Extension Publish ==");

    checkToken();

    run("npx vsce publish");

    console.log("✔ Published successfully.");
  } catch (err) {
    console.error("✖ Publish failed");
    console.error(err);
    process.exit(1);
  }
}

main();

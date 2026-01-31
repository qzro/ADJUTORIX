import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

/**
 * Build and package the VS Code extension into a .vsix file.
 * Zero external services. Local only.
 */

const ROOT = path.resolve(__dirname, "../../");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "release");

function run(cmd: string) {
  console.log(`[package] ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function clean() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
  }
  ensureDir(OUT);
}

function build() {
  run("npm run build");
}

function bundle() {
  run("npx vsce package --out release/adjutorix.vsix");
}

function main() {
  try {
    console.log("== Adjutorix Extension Packaging ==");

    clean();
    build();
    bundle();

    console.log("✔ Extension packaged successfully.");
    console.log(`✔ Output: ${OUT}/adjutorix.vsix`);
  } catch (err) {
    console.error("✖ Packaging failed");
    console.error(err);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist", "renderer");
const MANIFEST_PATH = path.join(DIST, "manifest.json");
const TMP_ENTRY = path.join(ROOT, ".adjutorix.renderer.entry.html");
const TMP_CONFIG = path.join(ROOT, ".adjutorix.vite.renderer.config.mjs");

process.env.TZ = "UTC";
process.env.LC_ALL = "C";
process.env.LANG = "C";

function assert(cond, msg) {
  if (!cond) throw new Error(`build-renderer:${msg}`);
}

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sri(buf) {
  return `sha256-${crypto.createHash("sha256").update(buf).digest("base64")}`;
}

function stableJson(value) {
  const normalize = (x) => {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(normalize);
    const out = {};
    for (const key of Object.keys(x).sort()) out[key] = normalize(x[key]);
    return out;
  };
  return JSON.stringify(normalize(value));
}

function readAllFiles(dir) {
  const out = [];
  const walk = (current) => {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) out.push(next);
    }
  };
  walk(dir);
  return out;
}

function writeFileDeterministic(target, content) {
  fs.writeFileSync(target, content);
  try {
    const t = new Date(0);
    fs.utimesSync(target, t, t);
  } catch {}
}

function cleanupTmp() {
  for (const target of [TMP_ENTRY, TMP_CONFIG]) {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
}

function makeEntryHtml() {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "    <title>Adjutorix</title>",
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    '    <script type="module" src="/src/renderer/main.tsx"></script>',
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function makeViteConfig() {
  return `
import { defineConfig } from "vite";
import path from "node:path";

const ROOT = ${JSON.stringify(ROOT)};
const DIST = ${JSON.stringify(DIST)};
const ENTRY = ${JSON.stringify(TMP_ENTRY)};

export default defineConfig({
  root: ROOT,
  base: "./",
  resolve: {
    alias: {
      "@app": path.join(ROOT, "src"),
      "@main": path.join(ROOT, "src/main"),
      "@renderer": path.join(ROOT, "src/renderer"),
      "@shared": path.join(ROOT, "src/shared"),
      "@ipc": path.join(ROOT, "src/ipc"),
    },
  },
  build: {
    outDir: DIST,
    emptyOutDir: true,
    sourcemap: true,
    manifest: false,
    rollupOptions: {
      input: {
        index: ENTRY,
      },
    },
  },
});
`.trimStart();
}

function runViteBuild() {
  return new Promise((resolve, reject) => {
    const viteBin = path.join(
      ROOT,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "vite.cmd" : "vite",
    );

    assert(fs.existsSync(viteBin), `vite_bin_missing:${viteBin}`);

    const child = spawn(
      viteBin,
      ["build", "--config", TMP_CONFIG, "--mode", process.env.NODE_ENV || "production", "--logLevel", "error"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          TZ: "UTC",
          LC_ALL: "C",
          LANG: "C",
        },
        stdio: "inherit",
      },
    );

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vite_failed:${code}`));
    });
  });
}

function normalizeRendererHtml() {
  const indexHtml = path.join(DIST, "index.html");
  if (fs.existsSync(indexHtml)) return;

  const htmlFiles = fs
    .readdirSync(DIST, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));

  assert(htmlFiles.length > 0, "renderer_html_missing");

  const preferred =
    htmlFiles.find((name) => name === ".adjutorix.renderer.entry.html") ??
    (htmlFiles.length === 1 ? htmlFiles[0] : null);

  assert(preferred, `renderer_html_ambiguous:${htmlFiles.join(",")}`);

  fs.renameSync(path.join(DIST, preferred), indexHtml);
}

function buildManifest() {
  assert(fs.existsSync(DIST), "dist_missing");

  const files = readAllFiles(DIST).filter(
    (abs) => path.resolve(abs) !== path.resolve(MANIFEST_PATH),
  );

  const assets = files
    .map((abs) => {
      const rel = path.relative(DIST, abs).replace(/\\/g, "/");
      const buf = fs.readFileSync(abs);
      return {
        path: rel,
        bytes: buf.length,
        sha256: sha256(buf),
        sri: sri(buf),
        ext: path.extname(rel).slice(1),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));

  const manifest = {
    schema: 1,
    generator: "adjutorix.build-renderer",
    env: {
      node: process.version,
      mode: process.env.NODE_ENV || "production",
    },
    counts: {
      files: assets.length,
      bytes: assets.reduce((sum, item) => sum + item.bytes, 0),
    },
    assets,
  };

  writeFileDeterministic(MANIFEST_PATH, Buffer.from(stableJson(manifest)));
  return manifest;
}

async function main() {
  const cmd = process.argv[2] || "build";

  if (cmd === "clean") {
    cleanupTmp();
    rmrf(DIST);
    return;
  }

  if (cmd !== "build" && cmd !== "verify") {
    throw new Error(`build-renderer:unknown_command:${cmd}`);
  }

  cleanupTmp();
  rmrf(DIST);
  ensureDir(DIST);

  writeFileDeterministic(TMP_ENTRY, makeEntryHtml());
  writeFileDeterministic(TMP_CONFIG, makeViteConfig());

  try {
    await runViteBuild();
    normalizeRendererHtml();
    const manifest = buildManifest();
    process.stdout.write(stableJson({ ok: true, manifest }) + "\n");
  } finally {
    cleanupTmp();
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});

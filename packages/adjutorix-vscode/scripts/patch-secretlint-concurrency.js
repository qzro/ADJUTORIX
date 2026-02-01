#!/usr/bin/env node
/**
 * Postinstall: patch @secretlint/node so concurrency is at least 1.
 * os.cpus().length can be 0 in restricted envs; p-map requires >= 1.
 */
const fs = require("fs");
const path = require("path");

const p = path.join(__dirname, "..", "node_modules", "@secretlint", "node", "module", "index.js");
if (!fs.existsSync(p)) return;

let s = fs.readFileSync(p, "utf8");
if (s.includes("concurrency: Math.max(1, os.cpus().length)")) return;

s = s.replace(/concurrency: os\.cpus\(\)\.length/g, "concurrency: Math.max(1, os.cpus().length)");
fs.writeFileSync(p, s);

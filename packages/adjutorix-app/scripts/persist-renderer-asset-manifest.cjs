const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const outFile = path.resolve(__dirname, "..", "dist", "renderer", "asset-manifest.json");
let jsonLine = null;

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  process.stdout.write(line + "\n");
  const s = line.trim();
  if (s.startsWith("{") && s.includes('"manifest"') && s.includes('"ok"')) {
    jsonLine = s;
  }
});

rl.on("close", () => {
  if (!jsonLine) {
    console.error("[adjutorix-app] renderer manifest json not found in build-renderer output");
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(JSON.parse(jsonLine), null, 2) + "\n");
  console.error(`[adjutorix-app] renderer asset manifest written to ${outFile}`);
});

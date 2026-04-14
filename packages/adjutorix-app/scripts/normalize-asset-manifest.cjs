const fs = require("node:fs");
const path = require("node:path");

const file = path.resolve(process.cwd(), "assets/asset-manifest.json");
const dropKeys = new Set(["generatedAt", "root", "absolutePath"]);

function normalize(value, parentKey = "") {
  if (Array.isArray(value)) {
    const arr = value.map((item) => normalize(item, parentKey));
    if (
      arr.every(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof item.relativePath === "string"
      )
    ) {
      arr.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }
    return arr;
  }

  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (dropKeys.has(key)) continue;
      let next = normalize(value[key], key);
      if (key === "assetsDir" && typeof next === "string") {
        next = path.basename(next);
      }
      out[key] = next;
    }
    return out;
  }

  return value;
}

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const normalized = normalize(raw);
fs.writeFileSync(file, JSON.stringify(normalized, null, 2) + "\n");

/* @ts-nocheck */
import { BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const MARKER = "ADJUTORIX_NATIVE_PORTFOLIO_HOST_V18";

const CH = {
  state: "adjutorix:v18:state",
  discover: "adjutorix:v18:discover",
  selectRoot: "adjutorix:v18:selectRoot",
  openFolder: "adjutorix:v18:openFolder",
  files: "adjutorix:v18:files",
  read: "adjutorix:v18:read",
  write: "adjutorix:v18:write",
  run: "adjutorix:v18:run",
};

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".py", ".sh",
  ".bash", ".zsh", ".yml", ".yaml", ".toml", ".ini", ".env", ".css", ".scss", ".html",
  ".xml", ".sql", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".r", ".lua", ".dart", ".scala", ".pl", ".lock", ".txt",
]);

const SKIP_DIR = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".vite",
  ".cache", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv",
  "venv", "site-packages", ".DS_Store",
]);

let activeRoot = canonical(process.env.ADJUTORIX_WORKSPACE_ROOT || process.cwd());

function canonical(p: string): string {
  return path.resolve(String(p || process.cwd()));
}

function exists(p: string): boolean {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function safeInside(root: string, rel = "."): string {
  const base = canonical(root);
  const target = canonical(path.join(base, rel));
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("path_escape_rejected");
  }
  return target;
}

function rootScore(dir: string): number {
  let score = 0;
  if (exists(path.join(dir, ".git"))) score += 1000;
  if (exists(path.join(dir, "pnpm-workspace.yaml"))) score += 900;
  if (exists(path.join(dir, "package.json"))) score += 700;
  if (exists(path.join(dir, "pyproject.toml"))) score += 650;
  if (exists(path.join(dir, "Cargo.toml"))) score += 500;
  if (exists(path.join(dir, "go.mod"))) score += 500;
  if (exists(path.join(dir, "Makefile"))) score += 400;
  if (exists(path.join(dir, "README.md")) || exists(path.join(dir, "README"))) score += 250;
  return score;
}

function isRootCandidate(dir: string): boolean {
  return rootScore(dir) >= 250;
}

function seedRoots(): string[] {
  const seeds = new Set<string>();
  const add = (p?: string) => {
    if (!p) return;
    const c = canonical(p);
    if (isDir(c)) seeds.add(c);
  };

  add(activeRoot);
  add(path.dirname(activeRoot));
  add(path.dirname(path.dirname(activeRoot)));
  add(path.dirname(path.dirname(path.dirname(activeRoot))));
  add(path.join(os.homedir(), "Downloads", "Apps"));
  add(path.join(os.homedir(), "Downloads", "Apps", "midiakiasat"));
  add(path.join(os.homedir(), "Downloads", "Apps", "midiakiasat", "qzro"));
  add(path.join(os.homedir(), "Downloads", "Apps", "midiakiasat", "Kaaffilm"));

  for (const raw of String(process.env.ADJUTORIX_PORTFOLIO_ROOTS || "").split(path.delimiter)) add(raw);
  return [...seeds];
}

async function discoverRoots(): Promise<any[]> {
  const found = new Map<string, any>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5 || !isDir(dir)) return;
    const name = path.basename(dir);
    if (SKIP_DIR.has(name) || name.startsWith(".Trash")) return;

    const score = rootScore(dir);
    if (score > 0) {
      found.set(dir, {
        path: dir,
        name: path.basename(dir),
        score,
        markers: [
          exists(path.join(dir, ".git")) ? "git" : "",
          exists(path.join(dir, "pnpm-workspace.yaml")) ? "pnpm-workspace" : "",
          exists(path.join(dir, "package.json")) ? "node" : "",
          exists(path.join(dir, "pyproject.toml")) ? "python" : "",
          exists(path.join(dir, "Cargo.toml")) ? "rust" : "",
          exists(path.join(dir, "go.mod")) ? "go" : "",
          exists(path.join(dir, "Makefile")) ? "make" : "",
        ].filter(Boolean),
      });
    }

    let entries: fs.Dirent[] = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const ent of entries.slice(0, 500)) {
      if (!ent.isDirectory()) continue;
      if (SKIP_DIR.has(ent.name) || ent.name.startsWith(".")) continue;
      await walk(path.join(dir, ent.name), depth + 1);
    }
  }

  for (const seed of seedRoots()) await walk(seed, 0);

  if (!found.has(activeRoot)) {
    found.set(activeRoot, { path: activeRoot, name: path.basename(activeRoot), score: 1, markers: ["active"] });
  }

  return [...found.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function isGeneratedRel(rel: string): boolean {
  const p = "/" + rel.replace(/\\/g, "/").toLowerCase();
  return p.includes("/node_modules/")
    || p.includes("/dist/")
    || p.includes("/build/")
    || p.includes("/coverage/")
    || p.includes("/.next/")
    || p.includes("/.turbo/")
    || p.includes("/.vite/")
    || p.includes("/.cache/")
    || p.includes("/__pycache__/")
    || p.includes("/.pytest_cache/")
    || p.includes("/.mypy_cache/")
    || p.includes("/.ruff_cache/")
    || p.includes("/.venv/")
    || p.includes("/venv/")
    || p.includes("/site-packages/")
    || p.includes("/.adjutorix-release/");
}

function isTextLike(rel: string): boolean {
  const base = path.basename(rel);
  if (base === "Makefile" || base === "Dockerfile" || base === "LICENSE" || base.startsWith(".env")) return true;
  return TEXT_EXT.has(path.extname(rel).toLowerCase());
}

function kindFor(rel: string): string {
  const p = rel.toLowerCase();
  if (p.includes("/test") || p.includes("spec.")) return "test";
  if (p.includes("/script") || p.endsWith(".sh")) return "script";
  if (p.includes("/config") || p.includes(".github/")) return "config";
  if (p.includes("/src/main") || p.includes("/main/")) return "main";
  if (p.includes("/src/preload") || p.includes("/preload/")) return "preload";
  if (p.includes("/src/renderer") || p.includes("/renderer/")) return "renderer";
  if (p.endsWith("package.json") || p.endsWith("pyproject.toml")) return "manifest";
  if (p.endsWith(".md")) return "doc";
  return "source";
}

async function collectFiles(root = activeRoot, includeGenerated = false): Promise<any[]> {
  const out: any[] = [];
  const base = canonical(root);

  async function walk(dir: string): Promise<void> {
    if (out.length >= 5000) return;
    let entries: fs.Dirent[] = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const ent of entries) {
      if (out.length >= 5000) return;
      const abs = path.join(dir, ent.name);
      const rel = path.relative(base, abs).replace(/\\/g, "/");
      if (!includeGenerated && isGeneratedRel(rel)) continue;

      if (ent.isDirectory()) {
        if (SKIP_DIR.has(ent.name) && !includeGenerated) continue;
        await walk(abs);
        continue;
      }

      if (!ent.isFile()) continue;
      if (!isTextLike(rel)) continue;

      let st: fs.Stats;
      try { st = await fsp.stat(abs); } catch { continue; }
      if (st.size > 1024 * 1024) continue;

      out.push({
        path: rel,
        name: path.basename(rel),
        kind: kindFor(rel),
        bytes: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
      });
    }
  }

  await walk(base);
  return out.sort((a, b) => {
    const rank = (x: any) =>
      (x.path === "README.md" ? -10000 : 0)
      + (x.kind === "manifest" ? -9000 : 0)
      + (x.kind === "main" ? -8000 : 0)
      + (x.kind === "renderer" ? -7000 : 0)
      + (x.kind === "script" ? -6000 : 0)
      + x.path.length;
    return rank(a) - rank(b) || a.path.localeCompare(b.path);
  });
}

async function buildTools(root: string, files: any[]): Promise<any[]> {
  const tools: any[] = [];

  const add = (id: string, label: string, command: string, lane = "tool") => {
    tools.push({ id, label, command, lane });
  };

  add("doctor", "Doctor", "echo ADJUTORIX_DOCTOR && pwd && node -v 2>/dev/null || true && pnpm -v 2>/dev/null || true && git branch --show-current 2>/dev/null || true && git rev-parse --short HEAD 2>/dev/null || true && git status --short | head -160", "doctor");
  add("build", "Build", "pnpm run build || npm run build || python3 -m build", "build");
  add("test", "Test", "pnpm test || npm test || pytest -q", "test");
  add("verify", "Verify", "pnpm run verify || bash configs/ci/verify.sh || bash scripts/verify.sh || true", "verify");
  add("status", "SCM status", "git status --short && git branch --show-current && git rev-parse --short HEAD", "scm");
  add("diff", "SCM diff", "git diff --stat && echo && git diff --name-only && echo && git diff | head -600", "scm");
  add("timeline", "Timeline", "git log --oneline --decorate --graph --max-count=120", "scm");
  add("inventory", "Source inventory", "find . -maxdepth 5 \\( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './build' \\) -prune -o -type f | sed 's#^./##' | sort | head -1200", "index");
  add("symbols", "Symbol index", "rg -n \"^(export default function|export function|function|class|const|def|async def) \" . --glob '!node_modules' --glob '!dist' --glob '!build' | head -800", "index");
  add("debt", "Debt scan", "rg -n \"TODO|FIXME|XXX|HACK|placeholder|mock|stub|toy|not implemented\" . --glob '!node_modules' --glob '!dist' --glob '!build' | head -800", "quality");

  const packageFiles = files.filter((f) => f.path.endsWith("package.json")).slice(0, 80);
  for (const f of packageFiles) {
    try {
      const abs = safeInside(root, f.path);
      const pkg = JSON.parse(await fsp.readFile(abs, "utf8"));
      const dir = path.dirname(f.path);
      for (const script of Object.keys(pkg.scripts || {}).slice(0, 80)) {
        const where = dir === "." ? "." : dir;
        add(`pkg:${where}:${script}`, `${where} › ${script}`, `pnpm --dir ${shellQuote(where)} run ${shellQuote(script)}`, "package");
      }
    } catch {}
  }

  for (const f of files.filter((x) => x.path.endsWith(".sh")).slice(0, 120)) {
    add(`sh:${f.path}`, path.basename(f.path), `bash ${shellQuote(f.path)}`, f.path.includes("verify") ? "verify" : "script");
  }

  for (const f of files.filter((x) => x.path.endsWith(".py") && /(^|\/)(cli|scripts|tools|bin)\//.test(x.path)).slice(0, 120)) {
    add(`py:${f.path}`, path.basename(f.path), `python3 ${shellQuote(f.path)} --help`, "python");
  }

  return tools;
}

async function readFile(input: any): Promise<any> {
  const rel = String(input?.path || input?.file || "");
  const root = canonical(input?.root || activeRoot);
  const abs = safeInside(root, rel);
  const st = await fsp.stat(abs);
  if (!st.isFile()) throw new Error("not_file");
  if (st.size > 1024 * 1024) throw new Error("file_too_large");
  const content = await fsp.readFile(abs, "utf8");
  return { root, path: rel, content, bytes: st.size, mtimeMs: Math.floor(st.mtimeMs) };
}

async function writeFile(input: any): Promise<any> {
  const rel = String(input?.path || input?.file || "");
  const root = canonical(input?.root || activeRoot);
  const abs = safeInside(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, String(input?.content ?? ""), "utf8");
  return { root, path: rel, bytes: Buffer.byteLength(String(input?.content ?? "")) };
}

async function runCommand(input: any): Promise<any> {
  const command = String(input?.command || "");
  if (!command.trim()) throw new Error("empty_command");
  const root = canonical(input?.root || activeRoot);
  safeInside(root, ".");
  const timeoutMs = Math.max(1000, Math.min(Number(input?.timeoutMs || 300000), 600000));

  return await new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: root,
      shell: true,
      env: { ...process.env, ADJUTORIX_WORKSPACE_ROOT: root },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const limit = 512 * 1024;

    child.stdout.on("data", (d) => { stdout = (stdout + d.toString()).slice(-limit); });
    child.stderr.on("data", (d) => { stderr = (stderr + d.toString()).slice(-limit); });

    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      resolve({ root, command, status: "timeout", exitCode: 124, stdout, stderr, durationMs: Date.now() - startedAt });
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        root,
        command,
        status: code === 0 ? "ok" : "failed",
        exitCode: code ?? 0,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function fullState(input: any = {}): Promise<any> {
  if (input.root) activeRoot = canonical(input.root);
  const includeGenerated = Boolean(input.includeGenerated);
  const roots = await discoverRoots();
  const files = await collectFiles(activeRoot, includeGenerated);
  const tools = await buildTools(activeRoot, files);
  return { marker: MARKER, root: activeRoot, roots, files, tools, channels: CH };
}

function wrap(fn: Function) {
  return async (_event: any, input: any) => {
    try {
      const data = await fn(input || {});
      return { ok: true, ...data };
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error), stack: String(error?.stack || "") };
    }
  };
}

function handle(channel: string, fn: Function): void {
  try { ipcMain.removeHandler(channel); } catch {}
  ipcMain.handle(channel, wrap(fn));
}

export function registerPortfolioWorkspaceV18(): void {
  handle(CH.state, fullState);
  handle(CH.discover, async (input: any) => {
    const roots = await discoverRoots();
    return { marker: MARKER, root: activeRoot, roots };
  });
  handle(CH.selectRoot, async (input: any) => {
    activeRoot = canonical(input.root);
    return await fullState(input);
  });
  handle(CH.openFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const options = { properties: ["openDirectory" as const] };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (!result.canceled && result.filePaths[0]) activeRoot = canonical(result.filePaths[0]);
    return await fullState({});
  });
  handle(CH.files, async (input: any) => {
    const root = canonical(input.root || activeRoot);
    const files = await collectFiles(root, Boolean(input.includeGenerated));
    return { marker: MARKER, root, files };
  });
  handle(CH.read, readFile);
  handle(CH.write, writeFile);
  handle(CH.run, runCommand);
}

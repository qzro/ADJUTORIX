// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";

const MARKER = "ADJUTORIX_NATIVE_COMMAND_CENTER_WORKBENCH_V12";

const COMMAND_BRIDGES = [
  "shell.execute",
  "shell.run",
  "terminal.execute",
  "terminal.run",
  "command.run",
  "commands.run",
  "runtime.runCommand",
];

const TASKS = [
  { id: "doctor", group: "doctor", label: "Doctor", command: "echo ADJUTORIX_DOCTOR && pwd && node -v && pnpm -v && git branch --show-current && git rev-parse --short HEAD && git status --short | head -120" },
  { id: "build", group: "build", label: "Build app", command: "pnpm --filter @adjutorix/app run build" },
  { id: "typecheck", group: "build", label: "Typecheck app", command: "pnpm --filter @adjutorix/app exec tsc -p tsconfig.json --noEmit --pretty false" },
  { id: "verify", group: "quality", label: "Verify repository", command: "pnpm run verify" },
  { id: "test", group: "quality", label: "Run tests", command: "pnpm test" },
  { id: "debt", group: "quality", label: "Debt scan", command: "rg -n \"TODO|FIXME|bridge unavailable|not implemented|placeholder|mock|stub|toy|launcher\" packages configs scripts src 2>/dev/null | head -300" },
  { id: "scm-status", group: "scm", label: "SCM status", command: "git status --short && echo && git branch --show-current && git rev-parse --short HEAD" },
  { id: "scm-diff", group: "scm", label: "SCM diff", command: "git diff --stat && echo && git diff --name-only && echo && git diff | head -700" },
  { id: "timeline", group: "scm", label: "Timeline", command: "git log --oneline --decorate --graph --max-count=80" },
  { id: "branches", group: "scm", label: "Branches", command: "git branch --all --verbose --no-abbrev | head -120" },
  { id: "health", group: "doctor", label: "Workspace health", command: "find . -maxdepth 4 \\( -name package.json -o -name tsconfig.json -o -name pnpm-workspace.yaml -o -name 'vite.config.*' \\) | sort | head -240" },
  { id: "map", group: "index", label: "Repo map", command: "find packages configs scripts src -maxdepth 4 -type f 2>/dev/null | sed 's#^#- #' | head -1200" },
];

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonl", ".md", ".mdx",
  ".py", ".sh", ".bash", ".zsh", ".yml", ".yaml", ".toml", ".css", ".html",
  ".sql", ".txt", ".log", ".env", ".example",
]);

const BINARY_RE = /\.(png|jpg|jpeg|gif|webp|icns|ico|woff|woff2|ttf|otf|zip|gz|tgz|pdf|mp4|mov|mp3|wav|sqlite|db|lock)$/i;
const IGNORE_RE = /(^|\/)(node_modules|\.git|dist|build|coverage|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.turbo|\.cache|\.vite|\.venv|venv|site-packages|quarantine)(\/|$)/i;
const MAX_OPEN_BYTES = 900_000;

function bridgeRoot() {
  const w = window as any;
  const a = w.adjutorix ?? {};
  const b = w.adjutorixApi ?? {};
  return {
    ...b,
    ...a,
    shell: a.shell ?? b.shell,
    terminal: a.terminal ?? b.terminal,
    command: a.command ?? b.command,
    commands: a.commands ?? b.commands,
    workspace: { ...(b.workspace ?? {}), ...(a.workspace ?? {}) },
    runtime: { ...(b.runtime ?? {}), ...(a.runtime ?? {}) },
    diagnostics: { ...(b.diagnostics ?? {}), ...(a.diagnostics ?? {}) },
    verify: { ...(b.verify ?? {}), ...(a.verify ?? {}) },
    patch: { ...(b.patch ?? {}), ...(a.patch ?? {}) },
    ledger: { ...(b.ledger ?? {}), ...(a.ledger ?? {}) },
    agent: { ...(b.agent ?? {}), ...(a.agent ?? {}) },
  };
}

function getPath(root: any, dotted: string) {
  return dotted.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), root);
}

function unwrap(value: any): any {
  if (value && typeof value === "object") {
    if (value.ok === true && "data" in value) return value.data;
    if (value.ok === true && "result" in value) return value.result;
    if (value.ok === true && "snapshot" in value) return value.snapshot;
  }
  return value;
}

async function callAny(paths: string[], payloads: any[] = [{}]) {
  const root = bridgeRoot();
  let sawFunction = false;
  let lastError: any = null;
  for (const path of paths) {
    const fn = getPath(root, path);
    if (typeof fn !== "function") continue;
    sawFunction = true;
    for (const payload of payloads) {
      try {
        return unwrap(await fn(payload));
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (!sawFunction) throw new Error(`bridge_missing:${paths.join("|")}`);
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "bridge_call_failed"));
}

async function executeNativeCommand(command: string, cwd?: string) {
  const payloads = [
    { schema: 1, actor: "renderer", command, intent: command, cwd, timeoutMs: 300_000 },
    { command, cwd, timeoutMs: 300_000 },
    { cmd: command, cwd, timeoutMs: 300_000 },
    command,
  ];
  return callAny(COMMAND_BRIDGES, payloads);
}

function normalizeCommand(raw: any, command: string, startedAt: number) {
  const result = unwrap(raw);
  const durationMs = Date.now() - startedAt;
  if (typeof result === "string") {
    return { command, status: "ok", ok: true, exitCode: 0, stdout: result, stderr: "", durationMs, startedAt };
  }
  if (result && typeof result === "object") {
    const exitCode = Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : undefined;
    const stdout = String(result.stdout ?? result.output ?? result.text ?? result.result ?? "");
    const stderr = String(result.stderr ?? result.errorOutput ?? "");
    const ok = result.ok === true || exitCode === 0 || result.status === "ok";
    return {
      command,
      status: String(result.status ?? (ok ? "ok" : "failed")),
      ok,
      exitCode,
      signal: result.signal ?? null,
      stdout,
      stderr,
      durationMs,
      startedAt,
    };
  }
  return { command, status: "ok", ok: true, exitCode: 0, stdout: JSON.stringify(result, null, 2), stderr: "", durationMs, startedAt };
}

function normalizePath(path: string) {
  return String(path ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function basename(path: string) {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function relativePath(path: string, root?: string | null) {
  const p = normalizePath(path);
  const r = normalizePath(root ?? "");
  if (!r) return p;
  if (p === r) return ".";
  return p.startsWith(r + "/") ? p.slice(r.length + 1) : p;
}

function extname(path: string) {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function isTextPath(path: string) {
  const p = normalizePath(path);
  if (!p || IGNORE_RE.test(p) || BINARY_RE.test(p)) return false;
  const ext = extname(p);
  if (TEXT_EXT.has(ext)) return true;
  return /(^|\/)(README|LICENSE|Dockerfile|Makefile|Procfile|\.gitignore|\.npmrc|pnpm-workspace\.yaml)$/i.test(p);
}

function languageFor(path: string) {
  const p = path.toLowerCase();
  if (p.endsWith(".tsx") || p.endsWith(".ts")) return "typescript";
  if (p.endsWith(".jsx") || p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs")) return "javascript";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".sh") || p.endsWith(".bash") || p.endsWith(".zsh")) return "shell";
  if (p.endsWith(".json") || p.endsWith(".jsonl")) return "json";
  if (p.endsWith(".md") || p.endsWith(".mdx")) return "markdown";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html")) return "html";
  if (p.endsWith(".toml")) return "toml";
  if (p.endsWith(".sql")) return "sql";
  return "plaintext";
}

function entryPath(entry: any): string | null {
  const p = entry?.path ?? entry?.fullPath ?? entry?.absolutePath ?? entry?.relativePath ?? entry?.workspacePath ?? entry?.filePath ?? entry?.id;
  return typeof p === "string" && p.trim() ? normalizePath(p) : null;
}

function isDirEntry(entry: any) {
  const kind = String(entry?.kind ?? entry?.type ?? entry?.entryType ?? "").toLowerCase();
  return entry?.isDirectory === true || entry?.directory === true || kind.includes("dir") || kind.includes("folder") || Array.isArray(entry?.children);
}

function childrenOf(entry: any) {
  return [entry?.children, entry?.entries, entry?.items, entry?.files, entry?.tree, entry?.workspaceTree, entry?.fileTree].find(Array.isArray) ?? [];
}

function flattenEntries(payloads: any[]) {
  const map = new Map<string, any>();
  const visit = (node: any) => {
    const value = unwrap(node);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const p = entryPath(value);
    if (p) {
      const isDir = isDirEntry(value);
      map.set(`${isDir ? "d" : "f"}:${p}`, {
        path: p,
        isDir,
        size: typeof value.size === "number" ? value.size : undefined,
      });
    }
    for (const child of childrenOf(value)) visit(child);
    for (const key of ["workspace", "data", "snapshot", "runtime", "root", "result"]) {
      if (value[key]) visit(value[key]);
    }
  };
  payloads.forEach(visit);
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function rankFile(file: any) {
  const p = normalizePath(file.path).toLowerCase();
  const name = basename(p);
  let score = 0;
  if (p.includes("/packages/adjutorix-app/src/renderer/")) score += 900_000;
  if (p.includes("/packages/adjutorix-app/src/preload/")) score += 850_000;
  if (p.includes("/packages/adjutorix-app/src/main/")) score += 830_000;
  if (p.includes("/packages/adjutorix-agent/")) score += 700_000;
  if (p.includes("/configs/")) score += 350_000;
  if (p.includes("/scripts/")) score += 260_000;
  if (p.includes("/tests/")) score += 200_000;
  if (name === "package.json") score += 120_000;
  if (name === "pnpm-workspace.yaml") score += 110_000;
  if (name === "readme.md") score += 100_000;
  if (p.endsWith(".tsx")) score += 10_000;
  if (p.endsWith(".ts")) score += 9_000;
  if (p.endsWith(".py")) score += 8_000;
  if (p.endsWith(".json")) score += 7_000;
  if (p.endsWith(".yml") || p.endsWith(".yaml")) score += 6_000;
  if (p.endsWith(".md")) score += 5_000;
  if (p.endsWith(".log")) score -= 120_000;
  return score - Math.min(p.length, 2000);
}

function sourceFiles(entries: any[]) {
  const seen = new Set<string>();
  const out = [];
  for (const entry of entries) {
    const p = normalizePath(entry.path);
    if (!p || entry.isDir || seen.has(p) || !isTextPath(p)) continue;
    if (typeof entry.size === "number" && entry.size > MAX_OPEN_BYTES) continue;
    seen.add(p);
    out.push({ ...entry, path: p, score: rankFile(entry) });
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.path.localeCompare(b.path));
}

function findRoot(entries: any[], snapshots: any[]) {
  for (const snap of snapshots) {
    let root: string | null = null;
    const scan = (node: any) => {
      const v = unwrap(node);
      if (!v || typeof v !== "object" || root) return;
      for (const key of ["rootPath", "workspaceRoot", "workspacePath", "repoPath", "cwd"]) {
        if (typeof v[key] === "string" && v[key].trim()) {
          root = normalizePath(v[key]);
          return;
        }
      }
      if (Array.isArray(v)) v.forEach(scan);
      else Object.values(v).forEach(scan);
    };
    scan(snap);
    if (root) return root;
  }
  const paths = entries.map((e) => normalizePath(e.path));
  for (const needle of ["/packages/", "/configs/", "/scripts/", "/tests/", "/docs/"]) {
    const match = paths.find((p) => p.includes(needle));
    if (match) return match.slice(0, match.indexOf(needle));
  }
  return null;
}

function contentFromRead(payload: any) {
  if (typeof payload === "string") return payload;
  const v = unwrap(payload);
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return String(v.content ?? v.text ?? v.value ?? v.body ?? "");
  return "";
}

function parseProblems(text: string) {
  const problems: any[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    let m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
    if (m) {
      problems.push({ file: normalizePath(m[1]), line: Number(m[2]), column: Number(m[3]), severity: "error", message: `${m[4]} ${m[5]}` });
      continue;
    }
    m = line.match(/^(.+?):(\d+):(\d+):\s+(error|warning):\s+(.+)$/i);
    if (m) {
      problems.push({ file: normalizePath(m[1]), line: Number(m[2]), column: Number(m[3]), severity: m[4].toLowerCase() === "warning" ? "warning" : "error", message: m[5] });
      continue;
    }
    if (/error|failed|exception/i.test(line)) problems.push({ severity: "error", message: line });
  }
  return problems.slice(0, 500);
}

function outline(content: string) {
  const items: any[] = [];
  const rules = [
    [/^\s*export\s+default\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*export\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*async\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*class\s+([A-Za-z0-9_$]+)/, "class"],
    [/^\s*const\s+([A-Za-z0-9_$]+)\s*=/, "const"],
    [/^\s*def\s+([A-Za-z0-9_]+)/, "function"],
    [/^\s*#{1,6}\s+(.+)/, "section"],
  ];
  content.split(/\r?\n/).forEach((line, index) => {
    for (const [re, kind] of rules) {
      const m = line.match(re as RegExp);
      if (m) {
        items.push({ line: index + 1, kind, name: m[1] });
        break;
      }
    }
  });
  return items.slice(0, 250);
}

function importsOf(content: string) {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((x) => /^(import|from\s+\S+\s+import|const\s+\S+\s*=\s*require\()/.test(x.text))
    .slice(0, 200);
}

function makePatch(original: string, current: string) {
  if (original === current) return "No patch.";
  const a = original.split(/\r?\n/);
  const b = current.split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  const out = ["--- original", "+++ current"];
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) out.push(`-${String(i + 1).padStart(4, " ")} ${a[i]}`);
      if (b[i] !== undefined) out.push(`+${String(i + 1).padStart(4, " ")} ${b[i]}`);
      if (out.length > 900) {
        out.push("[patch truncated]");
        break;
      }
    }
  }
  return out.join("\n");
}

export default function CommandCenterWorkbench() {
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [bridgeFns, setBridgeFns] = useState<string[]>([]);
  const [buffers, setBuffers] = useState<Record<string, any>>({});
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [left, setLeft] = useState("explorer");
  const [right, setRight] = useState("inspector");
  const [bottom, setBottom] = useState("terminal");
  const [query, setQuery] = useState("");
  const [terminalInput, setTerminalInput] = useState(TASKS[1].command);
  const [runs, setRuns] = useState<any[]>([]);
  const [activeRun, setActiveRun] = useState<any | null>(null);
  const [problems, setProblems] = useState<any[]>([]);
  const [activity, setActivity] = useState<string[]>([]);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentIntent, setAgentIntent] = useState("Inspect current workspace state, identify the next concrete patch, apply it, then run build and gates.");
  const editorRef = useRef<any>(null);

  const current = selected && buffers[selected] ? buffers[selected] : null;
  const fileList = useMemo(() => sourceFiles(entries), [entries]);
  const dirtyCount = useMemo(() => Object.values(buffers).filter((b: any) => b.dirty).length, [buffers]);

  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fileList.slice(0, 600);
    return fileList.filter((f) => {
      const rel = relativePath(f.path, root).toLowerCase();
      const loaded = String(buffers[f.path]?.content ?? "").toLowerCase();
      return rel.includes(q) || loaded.includes(q);
    }).slice(0, 800);
  }, [query, fileList, root, buffers]);

  const currentOutline = useMemo(() => outline(current?.content ?? ""), [current?.content]);
  const currentImports = useMemo(() => importsOf(current?.content ?? ""), [current?.content]);
  const currentPatch = useMemo(() => current ? makePatch(current.original, current.content) : "No file.", [current]);

  const log = useCallback((message: string) => {
    setActivity((prev) => [`${new Date().toLocaleTimeString()}  ${message}`, ...prev].slice(0, 400));
  }, []);

  const detectBridgeFns = useCallback(() => {
    const rootBridge = bridgeRoot();
    const out: string[] = [];
    const seen = new Set<any>();
    const walk = (node: any, parts: string[], depth: number) => {
      if (!node || typeof node !== "object" || seen.has(node) || depth > 7) return;
      seen.add(node);
      for (const [key, value] of Object.entries(node)) {
        const next = [...parts, key];
        if (typeof value === "function") out.push(next.join("."));
        else if (value && typeof value === "object") walk(value, next, depth + 1);
      }
    };
    walk(rootBridge, [], 0);
    setBridgeFns(out.sort());
    return out.sort();
  }, []);

  const runCommand = useCallback(async (command: string) => {
    const text = command.trim();
    if (!text) return null;
    const startedAt = Date.now();
    const pending = { command: text, status: "running", stdout: "", stderr: "", startedAt };
    setBusy(true);
    setBottom("terminal");
    setActiveRun(pending);
    log(`RUN ${text}`);
    try {
      const raw = await executeNativeCommand(text, root ?? undefined);
      const normalized = normalizeCommand(raw, text, startedAt);
      setRuns((prev) => [normalized, ...prev].slice(0, 100));
      setActiveRun(normalized);
      const parsed = parseProblems(`${normalized.stderr}\n${normalized.stdout}`);
      setProblems(parsed);
      if (parsed.length) setRight("problems");
      log(`DONE ${normalized.status} ${normalized.durationMs}ms`);
      return normalized;
    } catch (error) {
      const failed = {
        command: text,
        status: "bridge_error",
        ok: false,
        exitCode: undefined,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        startedAt,
      };
      setRuns((prev) => [failed, ...prev].slice(0, 100));
      setActiveRun(failed);
      setProblems(parseProblems(failed.stderr));
      log(`FAIL ${failed.stderr}`);
      return failed;
    } finally {
      setBusy(false);
    }
  }, [root, log]);

  const indexWorkspace = useCallback(async () => {
    setBusy(true);
    const bridge = detectBridgeFns();
    const payloads: any[] = [];
    for (const path of ["runtime.snapshot", "workspace.status", "workspace.tree", "workspace.scan", "diagnostics.runtime"]) {
      try {
        payloads.push(await callAny([path], [{ schema: 1, actor: "renderer" }]));
      } catch (error) {
        payloads.push({ error: String(error), source: path });
      }
    }

    let flattened = flattenEntries(payloads);
    if (sourceFiles(flattened).length < 20) {
      try {
        const raw = await executeNativeCommand("find . -maxdepth 7 -type f | sed 's#^./##' | head -2500", root ?? undefined);
        const normalized = normalizeCommand(raw, "find .", Date.now());
        const commandFiles = normalized.stdout.split(/\r?\n/).filter(Boolean).map((p) => ({ path: normalizePath(p), isDir: false }));
        flattened = [...flattened, ...commandFiles];
      } catch {}
    }

    const dedup = flattenEntries(flattened);
    const detectedRoot = findRoot(dedup, payloads) ?? root;
    setSnapshots(payloads);
    setEntries(dedup);
    setRoot(detectedRoot);
    setBridgeFns(bridge);
    log(`INDEX ${dedup.length} entries / ${sourceFiles(dedup).length} source files / bridge=${bridge.length}`);
    setBusy(false);
  }, [detectBridgeFns, log, root]);

  const openFile = useCallback(async (path: string) => {
    const full = normalizePath(path);
    const entry = entries.find((e) => normalizePath(e.path) === full);
    const rel = relativePath(full, root);

    if (entry?.isDir) {
      log(`SKIP DIRECTORY ${rel}`);
      return;
    }
    if (!isTextPath(full)) {
      log(`SKIP NON-TEXT ${rel}`);
      return;
    }
    if (typeof entry?.size === "number" && entry.size > MAX_OPEN_BYTES) {
      log(`SKIP TOO LARGE ${rel} ${entry.size} bytes`);
      return;
    }

    try {
      const payload = await callAny(["workspace.readFile"], [
        { schema: 1, actor: "renderer", path: rel, targetPath: rel, relativePath: rel, filePath: rel, workspacePath: rel },
        { path: rel },
        rel,
      ]);
      const content = contentFromRead(payload);
      const actualPath = normalizePath(payload?.path ?? full);
      setBuffers((prev) => ({
        ...prev,
        [actualPath]: {
          path: actualPath,
          content,
          original: content,
          language: languageFor(actualPath),
          dirty: false,
          openedAt: Date.now(),
        },
      }));
      setSelected(actualPath);
      setOpenFiles((prev) => Array.from(new Set([...prev, actualPath])));
      log(`OPEN ${relativePath(actualPath, root)}`);
    } catch (error) {
      const failed = {
        command: `open ${rel}`,
        status: "open_failed",
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        startedAt: Date.now(),
      };
      setActiveRun(failed);
      setBottom("terminal");
      log(`OPEN FAILED ${rel} :: ${failed.stderr}`);
    }
  }, [entries, root, log]);

  const saveFile = useCallback(async (path: string) => {
    const buffer = buffers[path];
    if (!buffer) return;
    const rel = relativePath(path, root);
    try {
      await callAny(["workspace.writeFile", "workspace.saveFile"], [
        { schema: 1, actor: "renderer", path: rel, targetPath: rel, relativePath: rel, filePath: rel, workspacePath: rel, content: buffer.content, text: buffer.content, value: buffer.content },
        { path: rel, content: buffer.content },
      ]);
      setBuffers((prev) => ({ ...prev, [path]: { ...buffer, original: buffer.content, dirty: false, savedAt: Date.now() } }));
      log(`SAVE ${rel}`);
    } catch (error) {
      log(`SAVE FAILED ${rel} :: ${String(error)}`);
    }
  }, [buffers, root, log]);

  const saveAll = useCallback(async () => {
    for (const buffer of Object.values(buffers).filter((b: any) => b.dirty)) await saveFile(buffer.path);
  }, [buffers, saveFile]);

  const writeAgentContext = useCallback(async () => {
    const dirty = Object.values(buffers).filter((b: any) => b.dirty);
    const content = [
      "# ADJUTORIX Native Agent Context",
      "",
      `marker=${MARKER}`,
      `root=${root ?? ""}`,
      `intent=${agentIntent}`,
      `current=${current ? relativePath(current.path, root) : "none"}`,
      `dirty=${dirty.map((b: any) => relativePath(b.path, root)).join(",") || "none"}`,
      "",
      "## Current patch",
      "",
      "```diff",
      currentPatch.slice(0, 30_000),
      "```",
      "",
      "## Problems",
      "",
      ...problems.slice(0, 80).map((p) => `- ${p.severity}: ${p.file ?? ""}${p.line ? `:${p.line}` : ""} ${p.message}`),
      "",
      "## Current file",
      "",
      "```",
      String(current?.content ?? "").slice(0, 40_000),
      "```",
      "",
      "## Activity",
      "",
      ...activity.slice(0, 120),
    ].join("\n");

    try {
      await callAny(["workspace.writeFile", "workspace.saveFile"], [
        { schema: 1, actor: "renderer", path: ".adjutorix/native-agent-context.md", content, text: content, value: content },
      ]);
      log("AGENT CONTEXT WRITTEN .adjutorix/native-agent-context.md");
      setRight("agent");
    } catch (error) {
      log(`AGENT CONTEXT FAILED ${String(error)}`);
    }
  }, [activity, agentIntent, buffers, current, currentPatch, log, problems, root]);

  const openWorkspace = useCallback(async () => {
    try {
      await callAny(["workspace.open"], [{ schema: 1, actor: "renderer", source: "ipc" }]);
      log("WORKSPACE OPEN COMPLETE");
    } catch (error) {
      log(`WORKSPACE OPEN FAILED ${String(error)}`);
    }
    await indexWorkspace();
  }, [indexWorkspace, log]);

  useEffect(() => {
    detectBridgeFns();
    indexWorkspace();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPalette(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) saveAll();
        else if (selected) saveFile(selected);
      }
      if (event.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveAll, saveFile, selected]);

  const paletteItems = useMemo(() => {
    const files = visibleFiles.slice(0, 120).map((f) => ({
      label: relativePath(f.path, root),
      kind: "file",
      run: () => openFile(f.path),
    }));
    const tasks = TASKS.map((task) => ({
      label: task.label,
      kind: task.group,
      run: () => {
        setTerminalInput(task.command);
        runCommand(task.command);
      },
    }));
    const all = [...tasks, ...files];
    const q = paletteQuery.trim().toLowerCase();
    return q ? all.filter((item) => item.label.toLowerCase().includes(q) || item.kind.toLowerCase().includes(q)) : all;
  }, [visibleFiles, root, openFile, runCommand, paletteQuery]);

  const renderLeft = () => {
    if (left === "commands" || left === "run" || left === "tasks") {
      return (
        <div className="ax-list">
          {TASKS.filter((task) => left !== "tasks" || ["doctor", "build", "quality"].includes(task.group)).map((task) => (
            <button key={task.id} className="ax-task" onClick={() => { setTerminalInput(task.command); runCommand(task.command); }}>
              <b>{task.label}</b>
              <span>{task.group}</span>
              <code>{task.command}</code>
            </button>
          ))}
        </div>
      );
    }
    if (left === "scm") {
      return (
        <div className="ax-list">
          {TASKS.filter((task) => task.group === "scm").map((task) => (
            <button key={task.id} className="ax-task" onClick={() => { setTerminalInput(task.command); runCommand(task.command); }}>
              <b>{task.label}</b>
              <code>{task.command}</code>
            </button>
          ))}
        </div>
      );
    }
    if (left === "agent") {
      return (
        <div className="ax-agentbox">
          <textarea value={agentIntent} onChange={(e) => setAgentIntent(e.target.value)} />
          <button onClick={writeAgentContext}>Write context pack</button>
          <p>Context includes current buffer, patch, dirty set, problems, activity, and runtime bridge posture.</p>
        </div>
      );
    }
    if (left === "runtime") {
      return <div className="ax-runtime">{bridgeFns.map((fn) => <button key={fn}>{fn}</button>)}</div>;
    }
    return (
      <div className="ax-list">
        {visibleFiles.map((file) => (
          <button key={file.path} title={file.path} className={selected === file.path ? "ax-file active" : "ax-file"} onClick={() => openFile(file.path)}>
            <span>{buffers[file.path]?.dirty ? "●" : "·"}</span>
            {relativePath(file.path, root)}
          </button>
        ))}
      </div>
    );
  };

  const renderRight = () => {
    if (right === "outline") {
      return <div className="ax-cardlist">{currentOutline.map((x) => <button key={`${x.line}:${x.name}`} onClick={() => editorRef.current?.revealLineInCenter?.(x.line)}><b>{x.kind}</b><span>{x.name}</span><em>line {x.line}</em></button>)}</div>;
    }
    if (right === "problems") {
      return <div className="ax-cardlist">{problems.length ? problems.map((p, i) => <button key={i} onClick={() => p.file && openFile(p.file)}><b className="bad">{p.severity}</b><span>{p.file ?? "command output"}{p.line ? `:${p.line}` : ""}</span><em>{p.message}</em></button>) : <p>No parsed problems.</p>}</div>;
    }
    if (right === "patch") return <pre className="ax-pre">{currentPatch}</pre>;
    if (right === "agent") return <div className="ax-agentbox"><textarea value={agentIntent} onChange={(e) => setAgentIntent(e.target.value)} /><button onClick={writeAgentContext}>Write context pack</button><pre>ROOT={root ?? ""}{"\n"}CURRENT={current ? relativePath(current.path, root) : "none"}{"\n"}DIRTY={dirtyCount}</pre></div>;
    if (right === "graph") return <div className="ax-cardlist"><h3>Current imports</h3>{currentImports.map((x) => <button key={x.line}><b>line {x.line}</b><span>{x.text}</span></button>)}<h3>Open buffers</h3>{openFiles.map((f) => <button key={f} onClick={() => setSelected(f)}>{relativePath(f, root)}</button>)}</div>;
    if (right === "runtime") return <div className="ax-runtime"><h3>Detected bridge functions</h3><strong>{bridgeFns.length}</strong>{bridgeFns.map((fn) => <button key={fn}>{fn}</button>)}</div>;
    return (
      <div className="ax-inspector">
        <div className="ax-current"><span>Current file</span><b>{current ? relativePath(current.path, root) : "none"}</b></div>
        <div className="ax-metrics">
          <div><span>entries</span><b>{entries.length}</b></div>
          <div><span>files</span><b>{fileList.length}</b></div>
          <div><span>open</span><b>{openFiles.length}</b></div>
          <div><span>dirty</span><b>{dirtyCount}</b></div>
        </div>
        <button disabled={!current?.dirty} onClick={() => current && setBuffers((prev) => ({ ...prev, [current.path]: { ...current, content: current.original, dirty: false } }))}>Revert current</button>
      </div>
    );
  };

  const terminal = activeRun ?? { command: terminalInput, status: "ready", stdout: "Pick a task or run a command. Output renders as terminal text, not raw JSON.", stderr: "" };

  return (
    <div className="ax-root">
      <header className="ax-top">
        <div className="ax-brand">{MARKER}</div>
        <button onClick={() => setPalette(true)}>⌘P command palette</button>
        <span className="ax-rootpath">{root ?? "workspace root unknown"}</span>
        <div className="ax-actions">
          <span>bridge {bridgeFns.length}</span>
          <span>dirty {dirtyCount}</span>
          <button onClick={openWorkspace}>Open workspace</button>
          <button onClick={indexWorkspace}>{busy ? "Working..." : "Index"}</button>
          <button disabled={!current?.dirty} onClick={() => current && saveFile(current.path)}>Save</button>
          <button disabled={!dirtyCount} onClick={saveAll}>Save all</button>
        </div>
      </header>

      <main className="ax-main">
        <nav className="ax-rail">
          {[
            ["explorer", "EX"], ["search", "SE"], ["scm", "SC"], ["commands", "CM"],
            ["run", "RU"], ["tasks", "TK"], ["agent", "AG"], ["graph", "GR"], ["runtime", "RT"],
          ].map(([id, label]) => <button key={id} className={left === id ? "active" : ""} onClick={() => setLeft(id)}>{label}</button>)}
        </nav>

        <aside className="ax-left">
          <div className="ax-sidehead">
            <span>{left}</span>
            <em>{visibleFiles.length}/{fileList.length}</em>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search files + loaded content" />
            {left === "search" && <button onClick={() => runCommand(`rg -n "${query.replace(/"/g, '\\"')}" packages configs scripts src 2>/dev/null | head -300`)}>Run repository grep</button>}
          </div>
          {renderLeft()}
        </aside>

        <section className="ax-center">
          <div className="ax-tabs">
            {openFiles.length ? openFiles.map((path) => (
              <button key={path} className={selected === path ? "active" : ""} onClick={() => setSelected(path)}>
                {buffers[path]?.dirty ? "● " : ""}{basename(path)}
                <i onClick={(e) => { e.stopPropagation(); setOpenFiles((prev) => prev.filter((x) => x !== path)); if (selected === path) setSelected(null); }}>×</i>
              </button>
            )) : <span>Open a source file.</span>}
          </div>
          <div className="ax-editor">
            {current ? (
              <Editor
                height="100%"
                theme="vs-dark"
                path={current.path}
                language={current.language}
                value={current.content}
                options={{ automaticLayout: true, fontSize: 14, minimap: { enabled: true }, scrollBeyondLastLine: false, renderWhitespace: "selection", wordWrap: "off" }}
                onMount={(editor) => { editorRef.current = editor; }}
                onChange={(value) => {
                  const next = value ?? "";
                  setBuffers((prev) => {
                    const old = prev[current.path];
                    return old ? { ...prev, [current.path]: { ...old, content: next, dirty: next !== old.original } } : prev;
                  });
                }}
              />
            ) : <div className="ax-empty">No file selected.</div>}
          </div>
          <div className="ax-bottom">
            <div className="ax-bottomtabs">{["terminal", "output", "problems", "patch", "graph", "raw"].map((id) => <button key={id} className={bottom === id ? "active" : ""} onClick={() => setBottom(id)}>{id}</button>)}</div>
            {bottom === "terminal" && (
              <div className="ax-terminal">
                <div className="ax-runline">
                  <input value={terminalInput} onChange={(e) => setTerminalInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runCommand(terminalInput); }} />
                  <button onClick={() => runCommand(terminalInput)}>Run</button>
                </div>
                <pre>
{`$ ${terminal.command}
status=${terminal.status}${terminal.exitCode !== undefined ? ` exit=${terminal.exitCode}` : ""} duration=${terminal.durationMs ?? 0}ms

${terminal.stdout || ""}${terminal.stderr ? `\n\n[stderr]\n${terminal.stderr}` : ""}`}
                </pre>
              </div>
            )}
            {bottom === "output" && <pre className="ax-pre">{activity.join("\n")}</pre>}
            {bottom === "problems" && <div className="ax-problems">{problems.length ? problems.map((p, i) => <button key={i} onClick={() => p.file && openFile(p.file)}><b>{p.severity}</b><span>{p.file ?? ""}{p.line ? `:${p.line}` : ""}</span><em>{p.message}</em></button>) : "No parsed problems."}</div>}
            {bottom === "patch" && <pre className="ax-pre">{currentPatch}</pre>}
            {bottom === "graph" && <pre className="ax-pre">{["CURRENT IMPORTS", ...currentImports.map((x) => `- ${x.text}  line ${x.line}`), "", "CURRENT SYMBOLS", ...currentOutline.map((x) => `- ${x.kind} ${x.name} line ${x.line}`)].join("\n")}</pre>}
            {bottom === "raw" && <pre className="ax-pre">{JSON.stringify({ snapshots, bridgeFns, activeRun }, null, 2)}</pre>}
          </div>
        </section>

        <aside className="ax-right">
          <div className="ax-righttabs">{["inspector", "outline", "problems", "patch", "agent", "graph", "runtime"].map((id) => <button key={id} className={right === id ? "active" : ""} onClick={() => setRight(id)}>{id}</button>)}</div>
          {renderRight()}
        </aside>
      </main>

      {palette && (
        <div className="ax-paletteback" onMouseDown={() => setPalette(false)}>
          <div className="ax-palette" onMouseDown={(e) => e.stopPropagation()}>
            <input autoFocus value={paletteQuery} onChange={(e) => setPaletteQuery(e.target.value)} placeholder="Type command or file..." onKeyDown={(e) => { if (e.key === "Enter" && paletteItems[0]) { paletteItems[0].run(); setPalette(false); } }} />
            <div>
              {paletteItems.slice(0, 80).map((item, index) => (
                <button key={`${item.kind}:${item.label}:${index}`} onClick={() => { item.run(); setPalette(false); }}>
                  <span>{item.label}</span><em>{item.kind}</em>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

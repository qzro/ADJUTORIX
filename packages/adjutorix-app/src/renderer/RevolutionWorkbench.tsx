// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";

const MARKER = "ADJUTORIX_NATIVE_IDE_WORKBENCH_V9";

type Any = any;

type Entry = {
  path: string;
  isDir?: boolean;
  size?: number;
  score?: number;
};

type BufferState = {
  path: string;
  content: string;
  original: string;
  language: string;
  dirty: boolean;
  openedAt: number;
  savedAt?: number;
  error?: string;
};

type Problem = {
  file?: string;
  line?: number;
  column?: number;
  severity: "error" | "warning" | "info";
  message: string;
};

type QuickCommand = {
  id: string;
  group: string;
  label: string;
  command: string;
};

const COMMAND_BRIDGES = [
  "shell.execute",
  "shell.run",
  "command.run",
  "commands.run",
  "terminal.execute",
  "terminal.run",
  "runtime.runCommand",
];

const QUICK_COMMANDS: QuickCommand[] = [
  {
    id: "doctor",
    group: "doctor",
    label: "Doctor",
    command:
      "echo ADJUTORIX_DOCTOR && pwd && node -v && pnpm -v && git branch --show-current && git rev-parse --short HEAD && git status --short | head -120",
  },
  {
    id: "build",
    group: "build",
    label: "Build app",
    command: "pnpm --filter @adjutorix/app run build",
  },
  {
    id: "typecheck",
    group: "build",
    label: "Typecheck app",
    command:
      "pnpm --filter @adjutorix/app exec tsc -p tsconfig.json --noEmit --pretty false",
  },
  {
    id: "verify",
    group: "quality",
    label: "Verify repository",
    command: "pnpm run verify",
  },
  {
    id: "test",
    group: "quality",
    label: "Run tests",
    command: "pnpm test",
  },
  {
    id: "debt",
    group: "quality",
    label: "Debt scan",
    command:
      'rg -n "T(O)DO|F(I)XME|bridge unavailable|not implemented" packages configs scripts src 2>/dev/null | head -300',
  },
  {
    id: "scm-status",
    group: "scm",
    label: "SCM status",
    command:
      "git status --short && echo && git branch --show-current && git rev-parse --short HEAD",
  },
  {
    id: "scm-diff",
    group: "scm",
    label: "SCM diff",
    command: "git diff --stat && echo && git diff --name-only && echo && git diff | head -500",
  },
  {
    id: "timeline",
    group: "scm",
    label: "Timeline",
    command: "git log --oneline --decorate --graph --max-count=80",
  },
  {
    id: "branches",
    group: "scm",
    label: "Branches",
    command: "git branch --all --verbose --no-abbrev | head -120",
  },
  {
    id: "repo-map",
    group: "index",
    label: "Write repo map",
    command: `python3 - <<'PY'
from pathlib import Path
root = Path.cwd()
out = root / ".adjutorix" / "repo-map.md"
out.parent.mkdir(parents=True, exist_ok=True)
skip = {".git","node_modules","dist","build","coverage",".turbo",".cache",".vite","__pycache__"}
rows = []
for p in sorted(root.rglob("*")):
    rel = p.relative_to(root)
    parts = set(rel.parts)
    if parts & skip:
        continue
    if p.is_file():
        rows.append(str(rel))
out.write_text("# ADJUTORIX Repository Map\\n\\n" + "\\n".join(f"- {r}" for r in rows[:5000]) + "\\n")
print(out)
PY`,
  },
  {
    id: "symbol-index",
    group: "index",
    label: "Symbol index",
    command:
      "rg -n \"^(export default function|export function|function|class|const|def|class )\" packages src configs scripts 2>/dev/null | head -500",
  },
  {
    id: "workspace-health",
    group: "doctor",
    label: "Workspace health",
    command:
      "find . -maxdepth 4 \\( -name package.json -o -name tsconfig.json -o -name pnpm-workspace.yaml -o -name vite.config.* \\) | sort | head -240",
  },
];

const CAPABILITIES = [
  ["Editor", "Monaco editor, tabs, dirty buffers, save, save-all, patch review"],
  ["Explorer", "ranked source index with noise filtering"],
  ["Search", "file search, loaded-content search, command-backed grep"],
  ["SCM", "status, diff, branches, timeline"],
  ["Terminal", "native command bridge via shell substrate"],
  ["Tasks", "build, typecheck, verify, test, health, debt scan, symbol index"],
  ["Problems", "parsed diagnostics from TypeScript, Python, shell, and command output"],
  ["Graph", "imports, symbols, hot files, source relationships"],
  ["Agent", "context pack writer under .adjutorix with current buffer and activity"],
  ["Runtime", "bridge inventory and compatibility posture"],
];

function api(): Any {
  const w = window as Any;
  const a = w.adjutorix ?? {};
  const b = w.adjutorixApi ?? {};
  return {
    ...b,
    ...a,
    shell: a.shell ?? b.shell,
    command: a.command ?? b.command,
    commands: a.commands ?? b.commands,
    terminal: a.terminal ?? b.terminal,
    workspace: { ...(b.workspace ?? {}), ...(a.workspace ?? {}) },
    runtime: { ...(b.runtime ?? {}), ...(a.runtime ?? {}) },
    diagnostics: { ...(b.diagnostics ?? {}), ...(a.diagnostics ?? {}) },
    verify: { ...(b.verify ?? {}), ...(a.verify ?? {}) },
    patch: { ...(b.patch ?? {}), ...(a.patch ?? {}) },
    ledger: { ...(b.ledger ?? {}), ...(a.ledger ?? {}) },
    agent: { ...(b.agent ?? {}), ...(a.agent ?? {}) },
  };
}

function obj(value: Any): Any {
  return value && typeof value === "object" ? value : {};
}

function unwrap(value: Any): Any {
  const v = obj(value);
  if (v.ok === true && "data" in v) return v.data;
  if (v.ok === true && "result" in v) return v.result;
  if (v.ok === true && "snapshot" in v) return v.snapshot;
  return value;
}

function atPath(root: Any, path: string): Any {
  let current = root;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return null;
    current = current[part];
  }
  return current;
}

async function callAny(paths: string[], requests: Any[] | Any = [{}]): Promise<Any> {
  const bridge = api();
  const list = Array.isArray(requests) ? requests : [requests];
  let found = false;
  let last: Any = null;

  for (const path of paths) {
    const fn = atPath(bridge, path);
    if (typeof fn !== "function") continue;
    found = true;

    for (const request of list) {
      const payload =
        typeof request === "string"
          ? { schema: 1, actor: "renderer", command: request, intent: request, timeoutMs: 180000 }
          : request && typeof request === "object"
            ? request
            : { schema: 1, actor: "renderer", value: request };

      try {
        return unwrap(await fn(payload));
      } catch (error) {
        last = error;
      }
    }
  }

  if (found) {
    throw last instanceof Error ? last : new Error(String(last ?? "bridge call failed"));
  }

  throw new Error(`bridge unavailable: ${paths.join(" | ")}`);
}

function functionsOf(value: Any): string[] {
  const out: string[] = [];
  const seen = new Set<Any>();

  const walk = (node: Any, prefix: string[], depth: number) => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > 7) return;
    seen.add(node);
    for (const [key, next] of Object.entries(node)) {
      const path = [...prefix, key];
      if (typeof next === "function") out.push(path.join("."));
      else if (next && typeof next === "object") walk(next, path, depth + 1);
    }
  };

  walk(value, [], 0);
  return out.sort();
}

function p(value: Any): string {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/g, "");
}

function basename(value: string): string {
  const parts = p(value).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function rel(path: string, root?: string | null): string {
  const file = p(path);
  const base = p(root);
  if (!base) return file;
  if (file === base) return ".";
  if (file.startsWith(base + "/")) return file.slice(base.length + 1);
  return file;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function childrenOf(node: Any): Any[] {
  return (
    ["children", "entries", "items", "files", "tree", "workspaceTree", "fileTree"]
      .map((key) => obj(node)[key])
      .find(Array.isArray) ?? []
  );
}

function entryPath(node: Any): string | null {
  const n = obj(node);
  const raw =
    n.path ??
    n.fullPath ??
    n.absolutePath ??
    n.relativePath ??
    n.workspacePath ??
    n.filePath ??
    n.id;
  return typeof raw === "string" && raw.trim() ? p(raw) : null;
}

function isDir(node: Any): boolean {
  const n = obj(node);
  const kind = String(n.kind ?? n.type ?? n.entryType ?? "").toLowerCase();
  return n.isDirectory === true || n.directory === true || kind.includes("dir") || kind.includes("folder") || childrenOf(n).length > 0;
}

function flatten(values: Any[]): Entry[] {
  const map = new Map<string, Entry>();

  const walk = (value: Any) => {
    const node = unwrap(value);
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const path = entryPath(node);
    if (path) {
      const entry = { path, isDir: isDir(node), size: typeof node.size === "number" ? node.size : undefined };
      map.set(`${entry.isDir ? "d" : "f"}:${entry.path}`, entry);
    }

    for (const child of childrenOf(node)) walk(child);
    for (const key of ["workspace", "data", "snapshot", "runtime", "root", "result"]) {
      if (obj(node)[key]) walk(obj(node)[key]);
    }
  };

  values.forEach(walk);
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function inferRoot(entries: Entry[], snapshots: Any[]): string | null {
  for (const snap of snapshots) {
    let root: string | null = null;
    const walk = (value: Any) => {
      const node = unwrap(value);
      if (!node || typeof node !== "object" || root) return;
      for (const key of ["rootPath", "workspaceRoot", "workspacePath", "repoPath", "cwd"]) {
        if (typeof node[key] === "string" && node[key].trim()) {
          root = p(node[key]);
          return;
        }
      }
      if (Array.isArray(node)) node.forEach(walk);
      else Object.values(node).forEach(walk);
    };
    walk(snap);
    if (root) return root;
  }

  const paths = entries.map((entry) => p(entry.path));
  for (const anchor of ["/packages/", "/configs/", "/scripts/", "/tests/", "/docs/"]) {
    const hit = paths.find((path) => path.includes(anchor));
    if (hit) return hit.slice(0, hit.indexOf(anchor));
  }

  return null;
}

function noise(path: string): boolean {
  const x = `/${p(path).toLowerCase()}/`;
  return (
    !x.trim() ||
    x.includes("/node_modules/") ||
    x.includes("/.git/") ||
    x.includes("/dist/") ||
    x.includes("/build/") ||
    x.includes("/coverage/") ||
    x.includes("/__pycache__/") ||
    x.includes("/.pytest_cache/") ||
    x.includes("/.mypy_cache/") ||
    x.includes("/.ruff_cache/") ||
    x.includes("/.turbo/") ||
    x.includes("/.cache/") ||
    x.includes("/.vite/") ||
    x.includes("/.venv/") ||
    x.includes("/venv/") ||
    x.includes("/site-packages/") ||
    x.includes("/quarantine/") ||
    /(^|\/)\.adjutorix-release(\/|$)/i.test(path)
  );
}

function binary(path: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|icns|ico|woff|woff2|ttf|otf|zip|gz|tgz|pdf|mp4|mov|mp3|wav|sqlite|db|lock)$/i.test(path);
}

function language(path: string): string {
  const x = path.toLowerCase();
  if (x.endsWith(".tsx") || x.endsWith(".ts")) return "typescript";
  if (x.endsWith(".jsx") || x.endsWith(".js") || x.endsWith(".mjs") || x.endsWith(".cjs")) return "javascript";
  if (x.endsWith(".json")) return "json";
  if (x.endsWith(".md")) return "markdown";
  if (x.endsWith(".py")) return "python";
  if (x.endsWith(".sh")) return "shell";
  if (x.endsWith(".css")) return "css";
  if (x.endsWith(".html")) return "html";
  if (x.endsWith(".yml") || x.endsWith(".yaml")) return "yaml";
  if (x.endsWith(".sql")) return "sql";
  return "plaintext";
}

function score(path: string): number {
  const x = p(path).toLowerCase();
  const name = basename(x);
  let value = 0;

  if (x.endsWith("/packages/adjutorix-app/src/renderer/revolutionworkbench.tsx")) value += 900000;
  if (x.endsWith("/packages/adjutorix-app/src/renderer/native-workbench.css")) value += 860000;
  if (x.endsWith("/packages/adjutorix-app/src/preload/preload.ts")) value += 840000;
  if (x.endsWith("/packages/adjutorix-app/src/main/index.ts")) value += 820000;
  if (x.endsWith("/packages/adjutorix-app/src/renderer/main.tsx")) value += 800000;

  if (x.includes("/src/renderer/")) value += 90000;
  if (x.includes("/src/main/")) value += 85000;
  if (x.includes("/src/preload/")) value += 80000;
  if (x.includes("/packages/")) value += 45000;
  if (x.includes("/configs/")) value += 22000;
  if (x.includes("/scripts/")) value += 16000;
  if (x.includes("/tests/")) value += 10000;

  if (name === "package.json") value += 55000;
  if (name === "pnpm-workspace.yaml") value += 50000;
  if (name === "readme.md") value += 35000;

  if (x.endsWith(".tsx")) value += 3000;
  if (x.endsWith(".ts")) value += 2500;
  if (x.endsWith(".json")) value += 1400;
  if (x.endsWith(".yaml") || x.endsWith(".yml")) value += 1300;
  if (x.endsWith(".md")) value += 900;
  if (x.endsWith(".py")) value += 900;
  if (x.endsWith(".sh")) value += 700;

  return value - Math.min(x.length, 1200);
}

function sourceFiles(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];

  for (const entry of entries) {
    const path = p(entry.path);
    if (!path || entry.isDir || noise(path) || binary(path) || seen.has(path)) continue;
    seen.add(path);
    out.push({ ...entry, path, score: score(path) });
  }

  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.path.localeCompare(b.path));
}

function commandResult(value: Any, command: string): Any {
  const v = obj(unwrap(value));
  if ("stdout" in v || "stderr" in v || "exitCode" in v || "status" in v) {
    return {
      ok: v.ok ?? v.exitCode === 0 ?? true,
      status: v.status ?? (v.exitCode === 0 ? "ok" : "done"),
      exitCode: v.exitCode,
      signal: v.signal,
      command: v.command ?? command,
      cwd: v.cwd,
      durationMs: v.durationMs,
      stdout: String(v.stdout ?? ""),
      stderr: String(v.stderr ?? ""),
    };
  }
  return {
    ok: true,
    status: "ok",
    command,
    stdout: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    stderr: "",
  };
}

function parseProblems(text: string): Problem[] {
  const problems: Problem[] = [];

  for (const line of String(text ?? "").split(/\r?\n/)) {
    let m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
    if (m) {
      problems.push({
        file: m[1],
        line: Number(m[2]),
        column: Number(m[3]),
        severity: "error",
        message: `${m[4]} ${m[5]}`,
      });
      continue;
    }

    m = line.match(/^(.+?):(\d+):(\d+):\s+(error|warning):\s+(.+)$/i);
    if (m) {
      problems.push({
        file: m[1],
        line: Number(m[2]),
        column: Number(m[3]),
        severity: m[4].toLowerCase() === "warning" ? "warning" : "error",
        message: m[5],
      });
      continue;
    }

    m = line.match(/^(.+?):(\d+):\s+(error|warning):\s+(.+)$/i);
    if (m) {
      problems.push({
        file: m[1],
        line: Number(m[2]),
        severity: m[3].toLowerCase() === "warning" ? "warning" : "error",
        message: m[4],
      });
      continue;
    }

    if (/error|failed|exception/i.test(line)) {
      problems.push({ severity: "error", message: line });
    }
  }

  return problems.slice(0, 500);
}

function symbols(text: string): Any[] {
  const out: Any[] = [];
  const patterns: [RegExp, string][] = [
    [/^\s*export\s+default\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*export\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*async\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*class\s+([A-Za-z0-9_$]+)/, "class"],
    [/^\s*const\s+([A-Za-z0-9_$]+)\s*=/, "const"],
    [/^\s*type\s+([A-Za-z0-9_$]+)\s*=/, "type"],
    [/^\s*interface\s+([A-Za-z0-9_$]+)/, "interface"],
    [/^\s*def\s+([A-Za-z0-9_]+)/, "function"],
    [/^\s*class\s+([A-Za-z0-9_]+)/, "class"],
    [/^\s*#{1,6}\s+(.+)/, "section"],
  ];

  text.split(/\r?\n/).forEach((line, index) => {
    for (const [pattern, kind] of patterns) {
      const m = line.match(pattern);
      if (m) {
        out.push({ line: index + 1, kind, name: m[1] });
        break;
      }
    }
  });

  return out.slice(0, 300);
}

function importsOf(text: string): string[] {
  const imports = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    let m = line.match(/^\s*import\s+.*?\s+from\s+["'](.+?)["']/);
    if (m) imports.add(m[1]);
    m = line.match(/^\s*import\s+["'](.+?)["']/);
    if (m) imports.add(m[1]);
    m = line.match(/require\(["'](.+?)["']\)/);
    if (m) imports.add(m[1]);
    m = line.match(/^\s*from\s+([A-Za-z0-9_./]+)\s+import\s+/);
    if (m) imports.add(m[1]);
  }

  return [...imports].sort();
}

function patch(original: string, current: string): string {
  if (original === current) return "No patch.";
  const a = original.split(/\r?\n/);
  const b = current.split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  const out = ["--- original", "+++ current"];

  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`-${String(i + 1).padStart(4, " ")} ${a[i]}`);
    if (b[i] !== undefined) out.push(`+${String(i + 1).padStart(4, " ")} ${b[i]}`);
    if (out.length > 900) {
      out.push("[patch truncated]");
      break;
    }
  }

  return out.join("\n");
}

function contentFrom(value: Any): string {
  if (typeof value === "string") return value;
  const v = obj(unwrap(value));
  return String(v.content ?? v.text ?? v.value ?? v.body ?? "");
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function writeCommand(path: string, text: string): string {
  const encoded = utf8Base64(text);
  return `python3 - <<'PY'
from pathlib import Path
import base64
path = Path(${JSON.stringify(path)})
path.parent.mkdir(parents=True, exist_ok=True)
path.write_bytes(base64.b64decode(${JSON.stringify(encoded)}))
print(path)
PY`;
}

export default function RevolutionWorkbench() {
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [snapshots, setSnapshots] = useState<Any[]>([]);
  const [buffers, setBuffers] = useState<Record<string, BufferState>>({});
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [leftMode, setLeftMode] = useState("explorer");
  const [rightMode, setRightMode] = useState("inspector");
  const [bottomMode, setBottomMode] = useState("terminal");
  const [query, setQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [command, setCommand] = useState("pnpm --filter @adjutorix/app run build");
  const [terminal, setTerminal] = useState<Any>({
    ok: true,
    status: "ready",
    stdout: "Run a command. This workbench uses the native shell bridge.",
    stderr: "",
  });
  const [log, setLog] = useState<string[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [bridgeFunctions, setBridgeFunctions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [agentIntent, setAgentIntent] = useState(
    "Inspect current workspace state, identify the next concrete patch, apply it, then run build and gates."
  );
  const [line, setLine] = useState<number | undefined>(undefined);

  const current = selectedPath && buffers[selectedPath] ? buffers[selectedPath] : null;
  const dirtyBuffers = useMemo(() => Object.values(buffers).filter((buffer) => buffer.dirty), [buffers]);
  const allFiles = useMemo(() => sourceFiles(entries), [entries]);

  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allFiles.slice(0, 1200);

    return allFiles
      .filter((entry) => {
        const relative = rel(entry.path, root).toLowerCase();
        const loaded = buffers[entry.path]?.content?.toLowerCase() ?? "";
        return relative.includes(q) || loaded.includes(q);
      })
      .slice(0, 1200);
  }, [allFiles, query, root, buffers]);

  const currentSymbols = useMemo(() => symbols(current?.content ?? ""), [current?.content]);
  const currentImports = useMemo(() => importsOf(current?.content ?? ""), [current?.content]);
  const currentPatch = useMemo(() => (current ? patch(current.original, current.content) : "No file."), [current]);
  const capabilityText = useMemo(() => CAPABILITIES.map(([name, value]) => `${name}: ${value}`).join("\n"), []);

  const addLog = useCallback((message: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${message}`, ...prev].slice(0, 500));
  }, []);

  const execute = useCallback(
    async (cmd: string, opts: Any = {}) => {
      setBusy(true);
      setBottomMode("terminal");
      if (!opts.quiet) addLog(`RUN ${cmd}`);

      try {
        const raw = await callAny(COMMAND_BRIDGES, [
          { schema: 1, actor: "renderer", command: cmd, intent: cmd, cwd: root ?? undefined, timeoutMs: opts.timeoutMs ?? 180000 },
          { command: cmd, cwd: root ?? undefined, timeoutMs: opts.timeoutMs ?? 180000 },
        ]);
        const result = commandResult(raw, cmd);
        setTerminal(result);

        if (result.cwd && !root) setRoot(p(result.cwd));

        const parsed = parseProblems(`${result.stderr ?? ""}\n${result.stdout ?? ""}`);
        if (parsed.length) setProblems(parsed);

        if (!opts.quiet) addLog(`DONE ${result.status ?? result.exitCode ?? "ok"}`);
        return result;
      } catch (error) {
        const result = {
          ok: false,
          status: "bridge_error",
          command: cmd,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
        };
        setTerminal(result);
        setProblems(parseProblems(result.stderr));
        addLog(`FAIL ${result.stderr}`);
        return result;
      } finally {
        setBusy(false);
      }
    },
    [addLog, root]
  );

  const openFile = useCallback(
    async (pathLike: string, explicitRoot?: string | null) => {
      const base = explicitRoot ?? root ?? null;
      const full = p(pathLike);
      const relative = rel(full, base);
      const entry = entries.find((item) => p(item.path) === full || rel(item.path, base) === relative);
      if (entry?.isDir) {
        addLog(`SKIP DIRECTORY ${relative}`);
        return;
      }

      try {
        const payload = await callAny(["workspace.readFile"], [
          {
            schema: 1,
            actor: "renderer",
            path: relative,
            targetPath: relative,
            relativePath: relative,
            filePath: relative,
            workspacePath: relative,
          },
          { path: relative },
        ]);

        const text = contentFrom(payload);
        const filePath = p(obj(payload).path ?? full);
        const buffer: BufferState = {
          path: filePath,
          content: text,
          original: text,
          language: language(filePath),
          dirty: false,
          openedAt: Date.now(),
        };

        setBuffers((prev) => ({ ...prev, [filePath]: buffer }));
        setSelectedPath(filePath);
        setOpenFiles((prev) => Array.from(new Set([...prev, filePath])));
        setLine(undefined);
        addLog(`OPEN ${rel(filePath, base)}`);
      } catch (error) {
        const fallback = await execute(
          `python3 - <<'PY'\nfrom pathlib import Path\nprint(Path(${JSON.stringify(relative)}).read_text())\nPY`,
          { timeoutMs: 30000, quiet: true }
        );

        if (fallback.ok !== false && fallback.stdout) {
          const filePath = full;
          const text = String(fallback.stdout ?? "");
          setBuffers((prev) => ({
            ...prev,
            [filePath]: {
              path: filePath,
              content: text,
              original: text,
              language: language(filePath),
              dirty: false,
              openedAt: Date.now(),
            },
          }));
          setSelectedPath(filePath);
          setOpenFiles((prev) => Array.from(new Set([...prev, filePath])));
          addLog(`OPEN ${rel(filePath, base)}`);
          return;
        }

        addLog(`OPEN FAILED ${relative} :: ${String(error)}`);
      }
    },
    [addLog, entries, execute, root]
  );

  const saveBuffer = useCallback(
    async (pathLike: string) => {
      const buffer = buffers[pathLike];
      if (!buffer) return;
      const relative = rel(pathLike, root);

      try {
        await callAny(["workspace.writeFile", "workspace.saveFile"], [
          {
            schema: 1,
            actor: "renderer",
            path: relative,
            targetPath: relative,
            relativePath: relative,
            filePath: relative,
            workspacePath: relative,
            content: buffer.content,
            text: buffer.content,
            value: buffer.content,
          },
          { path: relative, content: buffer.content },
        ]);

        setBuffers((prev) => ({
          ...prev,
          [pathLike]: { ...buffer, original: buffer.content, dirty: false, savedAt: Date.now() },
        }));
        addLog(`SAVE ${relative}`);
      } catch (error) {
        const result = await execute(writeCommand(relative, buffer.content), { timeoutMs: 30000, quiet: true });
        if (result.ok !== false) {
          setBuffers((prev) => ({
            ...prev,
            [pathLike]: { ...buffer, original: buffer.content, dirty: false, savedAt: Date.now() },
          }));
          addLog(`SAVE ${relative}`);
        } else {
          addLog(`SAVE FAILED ${relative} :: ${String(error)}`);
        }
      }
    },
    [addLog, buffers, execute, root]
  );

  const saveAll = useCallback(async () => {
    for (const buffer of Object.values(buffers).filter((item) => item.dirty)) {
      await saveBuffer(buffer.path);
    }
  }, [buffers, saveBuffer]);

  const indexWorkspace = useCallback(async () => {
    setBusy(true);
    const bridge = api();
    const collected: Any[] = [];

    for (const path of ["runtime.snapshot", "workspace.status", "workspace.tree", "workspace.scan", "diagnostics.runtime"]) {
      try {
        collected.push(await callAny([path]));
      } catch (error) {
        collected.push({ error: String(error), source: path });
      }
    }

    let flat = flatten(collected);
    let inferred = inferRoot(flat, collected);

    if (sourceFiles(flat).length === 0) {
      const fallback = await execute("git ls-files | sed -n '1,3000p'", { timeoutMs: 30000, quiet: true });
      const files = String(fallback.stdout ?? "")
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean)
        .map((path) => ({ path, isDir: false }));
      flat = files;
      if (fallback.cwd) inferred = p(fallback.cwd);
    }

    setSnapshots(collected);
    setEntries(flat);
    setRoot(inferred ?? root);
    setBridgeFunctions(functionsOf(bridge));

    const candidates = sourceFiles(flat);
    const first =
      candidates.find((entry) => /packages\/adjutorix-app\/src\/renderer\/RevolutionWorkbench\.tsx$/.test(entry.path)) ??
      candidates.find((entry) => /packages\/adjutorix-app\/src\/renderer\/App\.tsx$/.test(entry.path)) ??
      candidates[0];

    if (first && !selectedPath) await openFile(first.path, inferred ?? root);

    addLog(`INDEX ${flat.length} entries / ${sourceFiles(flat).length} source files / bridge=${functionsOf(bridge).length}`);
    setBusy(false);
  }, [addLog, execute, openFile, root, selectedPath]);

  const openWorkspace = useCallback(async () => {
    try {
      await callAny(["workspace.open"], [{ schema: 1, actor: "renderer", source: "workbench" }]);
      addLog("WORKSPACE OPEN COMPLETE");
    } catch (error) {
      addLog(`WORKSPACE OPEN FAILED ${String(error)}`);
    }
    await indexWorkspace();
  }, [addLog, indexWorkspace]);

  const updateCurrent = useCallback(
    (content: string) => {
      if (!current) return;
      setBuffers((prev) => {
        const existing = prev[current.path];
        if (!existing) return prev;
        return {
          ...prev,
          [current.path]: {
            ...existing,
            content,
            dirty: content !== existing.original,
          },
        };
      });
    },
    [current]
  );

  const closeFile = useCallback(
    (pathLike: string) => {
      setOpenFiles((prev) => prev.filter((item) => item !== pathLike));
      if (selectedPath === pathLike) {
        const next = openFiles.filter((item) => item !== pathLike)[0] ?? null;
        setSelectedPath(next);
      }
    },
    [openFiles, selectedPath]
  );

  const writeAgentContext = useCallback(async () => {
    const dirty = dirtyBuffers;
    const text = [
      "# ADJUTORIX Native Agent Context",
      "",
      `marker=${MARKER}`,
      `root=${root ?? ""}`,
      `intent=${agentIntent}`,
      `current=${current ? rel(current.path, root) : "none"}`,
      `dirty=${dirty.map((buffer) => rel(buffer.path, root)).join(",") || "none"}`,
      "",
      "## Capabilities",
      "",
      capabilityText,
      "",
      "## Current buffer",
      "",
      "```",
      (current?.content ?? "").slice(0, 40000),
      "```",
      "",
      "## Current patch",
      "",
      "```diff",
      currentPatch.slice(0, 30000),
      "```",
      "",
      "## Problems",
      "",
      problems
        .slice(0, 100)
        .map((problem) => `- ${problem.severity} ${problem.file ?? ""}${problem.line ? `:${problem.line}` : ""} ${problem.message}`)
        .join("\n"),
      "",
      "## Recent activity",
      "",
      log.slice(0, 150).join("\n"),
      "",
    ].join("\n");

    const target = ".adjutorix/native-agent-context.md";

    try {
      await callAny(["workspace.writeFile", "workspace.saveFile"], [
        {
          schema: 1,
          actor: "renderer",
          path: target,
          targetPath: target,
          relativePath: target,
          filePath: target,
          workspacePath: target,
          content: text,
          text,
          value: text,
        },
      ]);
      addLog(`AGENT CONTEXT WRITTEN ${target}`);
      setRightMode("agent");
      return;
    } catch (error) {
      addLog(`WORKSPACE WRITE FALLBACK ${String(error)}`);
    }

    await execute(writeCommand(target, text), { timeoutMs: 30000, quiet: true });
    setRightMode("agent");
  }, [agentIntent, capabilityText, current, currentPatch, dirtyBuffers, execute, log, problems, root, addLog]);

  const replaceInCurrent = useCallback(() => {
    if (!current || !query.trim()) return;
    const next = current.content.split(query).join("");
    updateCurrent(next);
    addLog(`REPLACE CURRENT ${query}`);
  }, [addLog, current, query, updateCurrent]);

  useEffect(() => {
    indexWorkspace();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "adjutorix.native.session.v9",
        JSON.stringify({
          selectedPath,
          openFiles,
          leftMode,
          rightMode,
          bottomMode,
          command,
        })
      );
    } catch {}
  }, [selectedPath, openFiles, leftMode, rightMode, bottomMode, command]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("adjutorix.native.session.v9") ?? "{}");
      if (saved.leftMode) setLeftMode(saved.leftMode);
      if (saved.rightMode) setRightMode(saved.rightMode);
      if (saved.bottomMode) setBottomMode(saved.bottomMode);
      if (saved.command) setCommand(saved.command);
    } catch {}
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault();
        if (selectedPath) void saveBuffer(selectedPath);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveAll();
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveAll, saveBuffer, selectedPath]);

  const runGrep = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    await execute(`rg -n ${shellQuote(q)} packages configs scripts src 2>/dev/null | head -400`, { timeoutMs: 60000 });
    setBottomMode("terminal");
  }, [execute, query]);

  const commandItems = useMemo(
    () =>
      QUICK_COMMANDS.map((cmd) => ({
        key: cmd.id,
        label: cmd.label,
        kind: cmd.group,
        run: () => {
          setCommand(cmd.command);
          void execute(cmd.command);
        },
      })),
    [execute]
  );

  const fileItems = useMemo(
    () =>
      visibleFiles.slice(0, 160).map((file) => ({
        key: file.path,
        label: rel(file.path, root),
        kind: "file",
        run: () => void openFile(file.path),
      })),
    [openFile, root, visibleFiles]
  );

  const paletteItems = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    const items = [...commandItems, ...fileItems];
    if (!q) return items.slice(0, 200);
    return items.filter((item) => item.label.toLowerCase().includes(q) || item.kind.toLowerCase().includes(q)).slice(0, 200);
  }, [commandItems, fileItems, paletteQuery]);

  const renderLeft = () => {
    if (leftMode === "commands" || leftMode === "run" || leftMode === "tasks") {
      return (
        <div className="adj-stack">
          {QUICK_COMMANDS.filter((cmd) => leftMode !== "tasks" || ["build", "quality", "doctor"].includes(cmd.group)).map((cmd) => (
            <button
              key={cmd.id}
              className="adj-card adj-card-button"
              onClick={() => {
                setCommand(cmd.command);
                void execute(cmd.command);
              }}
            >
              <span className="adj-card-title">{cmd.label}</span>
              <span className="adj-pill">{cmd.group}</span>
              <span className="adj-mono adj-muted">{cmd.command}</span>
            </button>
          ))}
        </div>
      );
    }

    if (leftMode === "scm") {
      return (
        <div className="adj-stack">
          {QUICK_COMMANDS.filter((cmd) => cmd.group === "scm").map((cmd) => (
            <button
              key={cmd.id}
              className="adj-card adj-card-button"
              onClick={() => {
                setCommand(cmd.command);
                void execute(cmd.command);
              }}
            >
              <span className="adj-card-title">{cmd.label}</span>
              <span className="adj-mono adj-muted">{cmd.command}</span>
            </button>
          ))}
          <div className="adj-card adj-muted">Native SCM surface: status, diff, timeline, branch/head, and command output.</div>
        </div>
      );
    }

    if (leftMode === "agent") {
      return (
        <div className="adj-stack">
          <textarea className="adj-textarea" value={agentIntent} onChange={(e) => setAgentIntent(e.target.value)} />
          <button className="adj-btn adj-primary" onClick={() => void writeAgentContext()}>
            Write agent context
          </button>
          <button
            className="adj-btn"
            onClick={() => navigator.clipboard?.writeText(JSON.stringify({ root, current: current?.path, intent: agentIntent }, null, 2))}
          >
            Copy minimal context
          </button>
          <div className="adj-card adj-muted">Agent context includes current buffer, patch, dirty set, problems, activity, and capabilities.</div>
        </div>
      );
    }

    if (leftMode === "runtime") {
      return (
        <div className="adj-stack adj-mono">
          {bridgeFunctions.map((fn) => (
            <button key={fn} className="adj-row" onClick={() => setQuery(fn)}>
              {fn}
            </button>
          ))}
        </div>
      );
    }

    if (leftMode === "graph") {
      return (
        <div className="adj-stack">
          <div className="adj-card">
            <div className="adj-card-title">Imports</div>
            {currentImports.length ? currentImports.map((item) => <div key={item} className="adj-mono adj-row">{item}</div>) : <div className="adj-muted">No imports.</div>}
          </div>
          <div className="adj-card">
            <div className="adj-card-title">Symbols</div>
            {currentSymbols.slice(0, 80).map((sym) => (
              <button key={`${sym.line}:${sym.name}`} className="adj-row" onClick={() => setLine(sym.line)}>
                <span className="adj-pill">{sym.kind}</span> {sym.name}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (leftMode === "search") {
      return (
        <div className="adj-stack">
          <button className="adj-btn" onClick={() => void runGrep()}>
            Run repository grep
          </button>
          <button className="adj-btn" disabled={!current || !query.trim()} onClick={replaceInCurrent}>
            Remove query from current buffer
          </button>
          <div className="adj-muted">Search matches filenames and loaded buffer content. Grep uses the native command bridge.</div>
          {visibleFiles.slice(0, 500).map((file) => (
            <button key={file.path} className={selectedPath === file.path ? "adj-file adj-active" : "adj-file"} onClick={() => void openFile(file.path)}>
              <span>{buffers[file.path]?.dirty ? "●" : "·"}</span>
              {rel(file.path, root)}
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className="adj-stack">
        {visibleFiles.map((file) => (
          <button key={file.path} className={selectedPath === file.path ? "adj-file adj-active" : "adj-file"} onClick={() => void openFile(file.path)}>
            <span>{buffers[file.path]?.dirty ? "●" : "·"}</span>
            {rel(file.path, root)}
          </button>
        ))}
      </div>
    );
  };

  const renderRight = () => {
    if (rightMode === "outline") {
      return (
        <div className="adj-stack">
          {currentSymbols.length ? (
            currentSymbols.map((sym) => (
              <button key={`${sym.line}:${sym.name}`} className="adj-card adj-card-button" onClick={() => setLine(sym.line)}>
                <span className="adj-pill">{sym.kind}</span>
                <span className="adj-card-title">{sym.name}</span>
                <span className="adj-muted">line {sym.line}</span>
              </button>
            ))
          ) : (
            <div className="adj-muted">No symbols.</div>
          )}
        </div>
      );
    }

    if (rightMode === "problems") {
      return (
        <div className="adj-stack">
          {problems.length ? (
            problems.map((problem, index) => (
              <button
                key={index}
                className="adj-card adj-card-button"
                onClick={() => problem.file && void openFile(problem.file)}
              >
                <span className={problem.severity === "error" ? "adj-sev-error" : "adj-sev-warning"}>{problem.severity.toUpperCase()}</span>
                <span className="adj-mono">{problem.file ?? ""}{problem.line ? `:${problem.line}:${problem.column ?? 1}` : ""}</span>
                <span>{problem.message}</span>
              </button>
            ))
          ) : (
            <div className="adj-muted">No parsed problems.</div>
          )}
        </div>
      );
    }

    if (rightMode === "patch") {
      return <pre className="adj-pre">{currentPatch}</pre>;
    }

    if (rightMode === "agent") {
      return (
        <div className="adj-stack">
          <textarea className="adj-textarea" value={agentIntent} onChange={(e) => setAgentIntent(e.target.value)} />
          <button className="adj-btn adj-primary" onClick={() => void writeAgentContext()}>
            Write context pack
          </button>
          <pre className="adj-pre">{[
            "ADJUTORIX_NATIVE_AGENT_CONTEXT",
            `ROOT=${root ?? ""}`,
            `CURRENT=${current ? rel(current.path, root) : "none"}`,
            `DIRTY=${dirtyBuffers.map((buffer) => rel(buffer.path, root)).join(",") || "none"}`,
            "",
            capabilityText,
            "",
            (current?.content ?? "").slice(0, 12000),
          ].join("\n")}</pre>
        </div>
      );
    }

    if (rightMode === "runtime") {
      return (
        <div className="adj-stack">
          <div className="adj-card">
            <div className="adj-muted">Detected bridge functions</div>
            <div className="adj-metric">{bridgeFunctions.length}</div>
          </div>
          <div className="adj-stack adj-mono">
            {bridgeFunctions.map((fn) => (
              <div key={fn} className="adj-row">{fn}</div>
            ))}
          </div>
        </div>
      );
    }

    if (rightMode === "graph") {
      return (
        <div className="adj-stack">
          <div className="adj-card">
            <div className="adj-card-title">Current imports</div>
            {currentImports.map((item) => <div key={item} className="adj-row adj-mono">{item}</div>)}
          </div>
          <div className="adj-card">
            <div className="adj-card-title">Open buffers</div>
            {openFiles.map((file) => <div key={file} className="adj-row">{rel(file, root)}</div>)}
          </div>
        </div>
      );
    }

    return (
      <div className="adj-stack">
        <div className="adj-card">
          <div className="adj-muted">Current file</div>
          <div className="adj-mono adj-green">{current ? rel(current.path, root) : "none"}</div>
        </div>
        <div className="adj-grid2">
          <div className="adj-card"><div className="adj-muted">entries</div><div className="adj-metric">{entries.length}</div></div>
          <div className="adj-card"><div className="adj-muted">files</div><div className="adj-metric">{allFiles.length}</div></div>
          <div className="adj-card"><div className="adj-muted">open</div><div className="adj-metric">{openFiles.length}</div></div>
          <div className="adj-card"><div className="adj-muted">dirty</div><div className="adj-metric">{dirtyBuffers.length}</div></div>
        </div>
        <button
          className="adj-btn"
          disabled={!current?.dirty}
          onClick={() => current && setBuffers((prev) => ({ ...prev, [current.path]: { ...current, content: current.original, dirty: false } }))}
        >
          Revert current
        </button>
        <div className="adj-card">
          <div className="adj-card-title">Capabilities</div>
          {CAPABILITIES.map(([name, value]) => (
            <div key={name} className="adj-row"><span className="adj-pill">{name}</span>{value}</div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="adj-root">
      <div className="adj-shell">
        <header className="adj-top">
          <div className="adj-top-left">
            <div className="adj-marker">{MARKER}</div>
            <button className="adj-btn" onClick={() => setPaletteOpen(true)}>⌘P command palette</button>
            <div className="adj-root-path">{root ?? "workspace root unknown"}</div>
          </div>
          <div className="adj-top-right">
            <span className="adj-pill">bridge {bridgeFunctions.length}</span>
            <span className="adj-pill">dirty {dirtyBuffers.length}</span>
            <button className="adj-btn" onClick={() => void openWorkspace()}>Open workspace</button>
            <button className="adj-btn" onClick={() => void indexWorkspace()}>{busy ? "Working..." : "Index"}</button>
            <button className="adj-btn adj-primary" disabled={!current?.dirty} onClick={() => current && void saveBuffer(current.path)}>Save</button>
            <button className="adj-btn adj-primary" disabled={!dirtyBuffers.length} onClick={() => void saveAll()}>Save all</button>
          </div>
        </header>

        <main className="adj-main">
          <nav className="adj-rail">
            {[
              ["explorer", "EX"],
              ["search", "SE"],
              ["scm", "SC"],
              ["commands", "CM"],
              ["run", "RU"],
              ["tasks", "TK"],
              ["agent", "AG"],
              ["graph", "GR"],
              ["runtime", "RT"],
            ].map(([id, label]) => (
              <button key={id} className={leftMode === id ? "adj-rail-btn adj-active" : "adj-rail-btn"} onClick={() => setLeftMode(id)}>
                {label}
              </button>
            ))}
          </nav>

          <aside className="adj-side">
            <div className="adj-side-head">
              <div className="adj-side-title">
                <span>{leftMode}</span>
                <span>{visibleFiles.length}/{allFiles.length}</span>
              </div>
              <input className="adj-input" aria-label="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="adj-side-body">{renderLeft()}</div>
          </aside>

          <section className="adj-center">
            <div className="adj-tabs">
              {openFiles.length === 0 ? (
                <span className="adj-muted">Open a source file.</span>
              ) : (
                openFiles.map((file) => (
                  <button key={file} className={selectedPath === file ? "adj-tab adj-active" : "adj-tab"} onClick={() => setSelectedPath(file)}>
                    {buffers[file]?.dirty ? "● " : ""}
                    {basename(file)}
                    <span className="adj-close" onClick={(event) => { event.stopPropagation(); closeFile(file); }}>×</span>
                  </button>
                ))
              )}
            </div>

            <div className="adj-editor">
              {current ? (
                <Editor
                  height="100%"
                  theme="vs-dark"
                  path={current.path}
                  language={current.language}
                  value={current.content}
                  line={line}
                  options={{
                    automaticLayout: true,
                    fontSize: 13,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    renderWhitespace: "selection",
                    wordWrap: "off",
                    bracketPairColorization: { enabled: true },
                    guides: { bracketPairs: true, indentation: true },
                  }}
                  onChange={(value) => updateCurrent(value ?? "")}
                />
              ) : (
                <div className="adj-empty">No file selected.</div>
              )}
            </div>

            <div className="adj-bottom">
              <div className="adj-bottom-tabs">
                {["terminal", "output", "problems", "patch", "graph", "raw"].map((id) => (
                  <button key={id} className={bottomMode === id ? "adj-link adj-active-text" : "adj-link"} onClick={() => setBottomMode(id)}>
                    {id}
                  </button>
                ))}
              </div>

              {bottomMode === "terminal" && (
                <div className="adj-terminal">
                  <div className="adj-command-row">
                    <input className="adj-command" aria-label="command" value={command} onChange={(e) => setCommand(e.target.value)} />
                    <button className="adj-btn" onClick={() => void execute(command)}>Run</button>
                  </div>
                  <pre className="adj-pre">{JSON.stringify(terminal, null, 2)}</pre>
                </div>
              )}

              {bottomMode === "output" && <pre className="adj-pre">{log.join("\n")}</pre>}
              {bottomMode === "patch" && <pre className="adj-pre">{currentPatch}</pre>}
              {bottomMode === "raw" && <pre className="adj-pre">{JSON.stringify(snapshots, null, 2)}</pre>}

              {bottomMode === "graph" && (
                <pre className="adj-pre">{[
                  "CURRENT IMPORTS",
                  ...currentImports.map((item) => `- ${item}`),
                  "",
                  "CURRENT SYMBOLS",
                  ...currentSymbols.map((item) => `- ${item.kind} ${item.name} line ${item.line}`),
                ].join("\n")}</pre>
              )}

              {bottomMode === "problems" && (
                <div className="adj-problems">
                  {problems.length ? problems.map((problem, index) => (
                    <button key={index} className="adj-problem" onClick={() => problem.file && void openFile(problem.file)}>
                      <span className={problem.severity === "error" ? "adj-sev-error" : "adj-sev-warning"}>{problem.severity}</span>
                      <span className="adj-mono">{problem.file ?? ""}{problem.line ? `:${problem.line}` : ""}</span>
                      <span>{problem.message}</span>
                    </button>
                  )) : <div className="adj-muted">No parsed problems.</div>}
                </div>
              )}
            </div>
          </section>

          <aside className="adj-right">
            <div className="adj-right-tabs">
              {["inspector", "outline", "problems", "patch", "agent", "graph", "runtime"].map((id) => (
                <button key={id} className={rightMode === id ? "adj-mini-tab adj-active" : "adj-mini-tab"} onClick={() => setRightMode(id)}>
                  {id}
                </button>
              ))}
            </div>
            <div className="adj-right-body">{renderRight()}</div>
          </aside>
        </main>
      </div>

      {paletteOpen && (
        <div className="adj-palette-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="adj-palette" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              className="adj-palette-input"
              aria-label="command palette"
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
            />
            <div className="adj-palette-list">
              {paletteItems.map((item) => (
                <button
                  key={item.key}
                  className="adj-palette-item"
                  onClick={() => {
                    item.run();
                    setPaletteOpen(false);
                    setPaletteQuery("");
                  }}
                >
                  <span>{item.label}</span>
                  <span className="adj-muted">{item.kind}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

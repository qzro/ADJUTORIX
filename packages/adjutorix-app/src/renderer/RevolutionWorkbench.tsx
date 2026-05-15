// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";

const MARKER = "ADJUTORIX_NATIVE_IDE_WORKBENCH_V8";

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
  label: string;
  command: string;
  group: string;
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
    id: "self",
    group: "doctor",
    label: "Self-test command bridge",
    command: "echo ADJUTORIX_COMMAND_BRIDGE_OK && pwd && git status --short | head -80",
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
    command: "pnpm --filter @adjutorix/app exec tsc -p tsconfig.json --noEmit --pretty false",
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
    id: "scm-status",
    group: "scm",
    label: "SCM status",
    command: "git status --short && git branch --show-current && git rev-parse --short HEAD",
  },
  {
    id: "scm-diff",
    group: "scm",
    label: "SCM diff",
    command: "git diff --stat && git diff --name-only && git diff -- packages/adjutorix-app/src/renderer/RevolutionWorkbench.tsx | head -260",
  },
  {
    id: "timeline",
    group: "scm",
    label: "Timeline",
    command: "git log --oneline --decorate --graph --max-count=80",
  },
  {
    id: "repo-map",
    group: "index",
    label: "Write repo map",
    command:
      "python3 - <<'PY'\nfrom pathlib import Path\nroot=Path('.')\nout=Path('.adjutorix/repo-map.md'); out.parent.mkdir(exist_ok=True)\nfiles=[p for p in root.rglob('*') if p.is_file() and not any(x in p.parts for x in ['.git','node_modules','dist','build','.turbo','.cache','.venv','venv'])]\nlines=['# ADJUTORIX Repo Map','',f'files={len(files)}','']\nfor p in sorted(files)[:2000]: lines.append(f'- {p}')\nout.write_text('\\n'.join(lines))\nprint(out)\nPY",
  },
  {
    id: "symbol-index",
    group: "index",
    label: "Write symbol index",
    command:
      "python3 - <<'PY'\nfrom pathlib import Path\nimport re,json\nroot=Path('.')\nrx=re.compile(r'^(?:export\\s+)?(?:async\\s+)?(?:function|class|const|def)\\s+([A-Za-z0-9_$]+)', re.M)\nitems=[]\nfor p in root.rglob('*'):\n    if not p.is_file() or any(x in p.parts for x in ['.git','node_modules','dist','build','.turbo','.cache','.venv','venv']): continue\n    if p.suffix.lower() not in ['.ts','.tsx','.js','.jsx','.py','.mjs','.cjs']: continue\n    try: text=p.read_text(errors='ignore')\n    except Exception: continue\n    for m in rx.finditer(text): items.append({'file':str(p),'symbol':m.group(1),'line':text[:m.start()].count('\\n')+1})\nout=Path('.adjutorix/symbol-index.json'); out.parent.mkdir(exist_ok=True); out.write_text(json.dumps(items,indent=2))\nprint(out, len(items))\nPY",
  },
  {
    id: "debt-scan",
    group: "quality",
    label: "Debt / placeholder scan",
    command: "rg -n \"TODO|FIXME|throw new Error|bridge_missing|placeholder|mock|stub|toy|launcher\" packages configs scripts src 2>/dev/null | head -260",
  },
  {
    id: "health",
    group: "doctor",
    label: "Workspace health",
    command: "find . -maxdepth 3 -name package.json -o -name tsconfig.json -o -name pnpm-workspace.yaml -o -name vite.config.* | sort | head -200",
  },
];

const CAPABILITIES = [
  ["Editor", "Monaco editor, tabs, dirty buffers, save/save-all, patch view, outline"],
  ["Explorer", "indexed source list, loaded-content search, noise filtering"],
  ["Search", "file/content search through indexed buffers and bridge output"],
  ["SCM", "status, diff, timeline, branch/head introspection"],
  ["Terminal", "native command bridge through shell.execute and fallbacks"],
  ["Tasks", "build, typecheck, verify, test, debt scan, repo map, symbol index"],
  ["Problems", "parsed TypeScript/Python/shell diagnostics from command output"],
  ["Agent", "real context file writer under .adjutorix, current buffer included"],
  ["Runtime", "bridge function inventory and compatibility posture"],
  ["Governance", "verify/policy commands remain native, not decorative"],
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

function cleanPath(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/g, "");
}

function baseName(path: unknown): string {
  const parts = cleanPath(path).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? String(path ?? "");
}

function relative(path: unknown, root: unknown): string {
  const p = cleanPath(path);
  const r = cleanPath(root);
  if (!r) return p;
  if (p === r) return ".";
  if (p.startsWith(r + "/")) return p.slice(r.length + 1);
  return p;
}

function asObject(value: unknown): Any {
  return value && typeof value === "object" ? value : {};
}

function unwrap(value: unknown): Any {
  const o = asObject(value);
  if (o.ok === true && "data" in o) return o.data;
  if (o.ok === true && "result" in o) return o.result;
  if (o.ok === true && "snapshot" in o) return o.snapshot;
  return value;
}

function getPath(obj: Any, dotted: string): Any {
  let cur = obj;
  for (const part of dotted.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return cur;
}

function bridgeFunctions(obj: Any): string[] {
  const out: string[] = [];
  const seen = new Set<Any>();
  const walk = (value: Any, prefix: string[], depth: number) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 7) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      const next = [...prefix, key];
      if (typeof child === "function") out.push(next.join("."));
      else if (child && typeof child === "object") walk(child, next, depth + 1);
    }
  };
  walk(obj, [], 0);
  return out.sort();
}

async function callAny(paths: string[], requests: Any[] | Any = [{}]): Promise<Any> {
  const rootApi = api();
  const normalized = Array.isArray(requests) ? requests : [requests];

  let sawFunction = false;
  let lastError: unknown = null;

  for (const path of paths) {
    const fn = getPath(rootApi, path);
    if (typeof fn !== "function") continue;
    sawFunction = true;

    for (const raw of normalized) {
      const request =
        typeof raw === "string"
          ? { schema: 1, actor: "renderer", command: raw, intent: raw, timeoutMs: 180000 }
          : raw && typeof raw === "object"
            ? raw
            : { schema: 1, actor: "renderer", value: raw };

      try {
        return unwrap(await fn(request));
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (!sawFunction) throw new Error(`bridge_missing:${paths.join("|")}`);
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "bridge_call_failed"));
}

function fileArrays(value: Any): Any[] {
  return [value.children, value.entries, value.items, value.files, value.tree, value.workspaceTree, value.fileTree].find(Array.isArray) ?? [];
}

function entryPath(value: Any): string | null {
  const o = asObject(value);
  const p = o.path ?? o.fullPath ?? o.absolutePath ?? o.relativePath ?? o.workspacePath ?? o.filePath ?? o.id;
  return typeof p === "string" && p.trim() ? cleanPath(p) : null;
}

function isDir(value: Any): boolean {
  const o = asObject(value);
  const kind = String(o.kind ?? o.type ?? o.entryType ?? "").toLowerCase();
  return o.isDirectory === true || o.directory === true || kind.includes("dir") || kind.includes("folder") || fileArrays(o).length > 0;
}

function flattenEntries(payloads: Any[]): Entry[] {
  const map = new Map<string, Entry>();

  const walk = (value: Any) => {
    const v = unwrap(value);
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }

    const p = entryPath(v);
    if (p) {
      const entry: Entry = {
        path: p,
        isDir: isDir(v),
        size: typeof v.size === "number" ? v.size : undefined,
      };
      map.set(`${entry.isDir ? "d" : "f"}:${entry.path}`, entry);
    }

    for (const child of fileArrays(v)) walk(child);
    for (const key of ["workspace", "data", "snapshot", "runtime", "root", "result"]) {
      if (v[key]) walk(v[key]);
    }
  };

  payloads.forEach(walk);
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function noise(path: string): boolean {
  const p = `/${cleanPath(path).toLowerCase()}/`;
  return (
    !p.trim() ||
    p.includes("/node_modules/") ||
    p.includes("/.git/") ||
    p.includes("/dist/") ||
    p.includes("/build/") ||
    p.includes("/coverage/") ||
    p.includes("/__pycache__/") ||
    p.includes("/.pytest_cache/") ||
    p.includes("/.mypy_cache/") ||
    p.includes("/.ruff_cache/") ||
    p.includes("/.turbo/") ||
    p.includes("/.cache/") ||
    p.includes("/.vite/") ||
    p.includes("/.venv/") ||
    p.includes("/venv/") ||
    p.includes("/site-packages/") ||
    p.includes("/quarantine/") ||
    /(^|\/)\.adjutorix-release(\/|$)/i.test(path)
  );
}

function binary(path: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|icns|ico|woff|woff2|ttf|otf|zip|gz|tgz|pdf|mp4|mov|mp3|wav|sqlite|db|lock)$/i.test(path);
}

function language(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".tsx") || p.endsWith(".ts")) return "typescript";
  if (p.endsWith(".jsx") || p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs")) return "javascript";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".sh")) return "shell";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html")) return "html";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  if (p.endsWith(".sql")) return "sql";
  return "plaintext";
}

function score(path: string): number {
  const p = cleanPath(path).toLowerCase();
  const b = baseName(p).toLowerCase();
  let s = 0;

  if (p.endsWith("/packages/adjutorix-app/src/renderer/revolutionworkbench.tsx")) s += 800000;
  if (p.endsWith("/packages/adjutorix-app/src/preload/preload.ts")) s += 760000;
  if (p.endsWith("/packages/adjutorix-app/src/main/index.ts")) s += 740000;
  if (p.endsWith("/packages/adjutorix-app/src/renderer/main.tsx")) s += 720000;
  if (p.includes("/src/renderer/")) s += 90000;
  if (p.includes("/src/main/")) s += 85000;
  if (p.includes("/src/preload/")) s += 80000;
  if (p.includes("/packages/")) s += 45000;
  if (p.includes("/configs/")) s += 22000;
  if (p.includes("/scripts/")) s += 16000;
  if (p.includes("/tests/")) s += 10000;

  if (b === "package.json") s += 55000;
  if (b === "pnpm-workspace.yaml") s += 50000;
  if (b === "readme.md") s += 35000;

  if (p.endsWith(".tsx")) s += 3000;
  if (p.endsWith(".ts")) s += 2500;
  if (p.endsWith(".json")) s += 1400;
  if (p.endsWith(".yaml") || p.endsWith(".yml")) s += 1300;
  if (p.endsWith(".md")) s += 900;
  if (p.endsWith(".py")) s += 900;
  if (p.endsWith(".sh")) s += 700;

  return s - Math.min(p.length, 1000);
}

function sourceFiles(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];

  for (const entry of entries) {
    const p = cleanPath(entry.path);
    if (!p || entry.isDir || noise(p) || binary(p) || seen.has(p)) continue;
    seen.add(p);
    out.push({ ...entry, path: p, score: score(p) });
  }

  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.path.localeCompare(b.path));
}

function inferRoot(entries: Entry[], payloads: Any[]): string | null {
  for (const payload of payloads) {
    let found: string | null = null;

    const walk = (value: Any) => {
      const v = unwrap(value);
      if (!v || typeof v !== "object" || found) return;

      for (const key of ["rootPath", "workspaceRoot", "workspacePath", "repoPath", "cwd"]) {
        if (typeof v[key] === "string" && v[key].trim()) {
          found = cleanPath(v[key]);
          return;
        }
      }

      if (Array.isArray(v)) v.forEach(walk);
      else Object.values(v).forEach(walk);
    };

    walk(payload);
    if (found) return found;
  }

  const paths = entries.map((entry) => cleanPath(entry.path));
  for (const marker of ["/packages/", "/configs/", "/scripts/", "/tests/", "/docs/"]) {
    const hit = paths.find((p) => p.includes(marker));
    if (hit) return hit.slice(0, hit.indexOf(marker));
  }

  return null;
}

function textFrom(value: Any): string {
  if (typeof value === "string") return value;
  const o = asObject(unwrap(value));
  return String(o.content ?? o.text ?? o.value ?? o.body ?? "");
}

function normalizeCommandResult(value: Any, command: string): Any {
  const o = asObject(unwrap(value));
  if ("stdout" in o || "stderr" in o || "exitCode" in o || "status" in o) return o;
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

    if (/error|failed|exception/i.test(line)) {
      problems.push({ severity: "error", message: line });
    }
  }

  return problems.slice(0, 400);
}

function outline(text: string): Any[] {
  const out: Any[] = [];
  const patterns: [RegExp, string][] = [
    [/^\s*export\s+default\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*async\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*class\s+([A-Za-z0-9_$]+)/, "class"],
    [/^\s*const\s+([A-Za-z0-9_$]+)\s*=/, "const"],
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

  return out.slice(0, 250);
}

function patch(original: string, current: string): string {
  if (original === current) return "No patch.";

  const a = original.split(/\r?\n/);
  const b = current.split(/\r?\n/);
  const limit = Math.max(a.length, b.length);
  const out = ["--- original", "+++ current"];

  for (let i = 0; i < limit; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`-${String(i + 1).padStart(4, " ")} ${a[i]}`);
    if (b[i] !== undefined) out.push(`+${String(i + 1).padStart(4, " ")} ${b[i]}`);
    if (out.length > 700) {
      out.push("[patch truncated]");
      break;
    }
  }

  return out.join("\n");
}

function encodeBase64Utf8(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export default function RevolutionWorkbench() {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [buffers, setBuffers] = useState<Record<string, BufferState>>({});
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [leftMode, setLeftMode] = useState("explorer");
  const [rightMode, setRightMode] = useState("inspector");
  const [bottomMode, setBottomMode] = useState("terminal");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [rawSnapshots, setRawSnapshots] = useState<Any[]>([]);
  const [bridgeEntries, setBridgeEntries] = useState<string[]>([]);
  const [outputLog, setOutputLog] = useState<string[]>([]);
  const [terminalCommand, setTerminalCommand] = useState("pnpm --filter @adjutorix/app run build");
  const [terminalOutput, setTerminalOutput] = useState<Any>({
    status: "ready",
    stdout: "ADJUTORIX V8 command substrate ready. Object-only bridge calls enforced.",
    stderr: "",
  });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [agentIntent, setAgentIntent] = useState("Inspect current workspace state and propose the next concrete patch.");
  const [activity, setActivity] = useState<string[]>([]);

  const current = selectedPath && buffers[selectedPath] ? buffers[selectedPath] : null;
  const dirtyCount = useMemo(() => Object.values(buffers).filter((b) => b.dirty).length, [buffers]);

  const addLog = useCallback((message: string) => {
    const line = `${new Date().toLocaleTimeString()}  ${message}`;
    setOutputLog((prev) => [line, ...prev].slice(0, 500));
    setActivity((prev) => [line, ...prev].slice(0, 300));
  }, []);

  const files = useMemo(() => {
    const all = sourceFiles(entries);
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 1200);

    return all
      .filter((entry) => {
        const rel = relative(entry.path, workspaceRoot).toLowerCase();
        const content = String(buffers[entry.path]?.content ?? "").toLowerCase();
        return rel.includes(q) || content.includes(q);
      })
      .slice(0, 1200);
  }, [entries, query, workspaceRoot, buffers]);

  const currentOutline = useMemo(() => outline(current?.content ?? ""), [current?.content]);
  const currentPatch = useMemo(() => (current ? patch(current.original, current.content) : "No file."), [current]);
  const capabilityText = useMemo(
    () => CAPABILITIES.map(([name, value]) => `${name}: ${value}`).join("\n"),
    []
  );

  const runCommand = useCallback(
    async (command: string, timeoutMs = 180000) => {
      setWorking(true);
      setBottomMode("terminal");
      addLog(`RUN ${command}`);

      try {
        const result = normalizeCommandResult(
          await callAny(COMMAND_BRIDGES, [
            { schema: 1, actor: "renderer", command, intent: command, cwd: workspaceRoot ?? undefined, timeoutMs },
            { command, cwd: workspaceRoot ?? undefined, timeoutMs },
          ]),
          command
        );

        setTerminalOutput(result);
        const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
        const parsed = parseProblems(text);
        if (parsed.length) setProblems(parsed);
        addLog(`DONE ${result.status ?? result.exitCode ?? "ok"}`);
        return result;
      } catch (error) {
        const result = {
          ok: false,
          status: "bridge_error",
          command,
          stderr: error instanceof Error ? error.message : String(error),
          stdout: "",
        };
        setTerminalOutput(result);
        setProblems(parseProblems(result.stderr));
        addLog(`FAIL ${result.stderr}`);
        return result;
      } finally {
        setWorking(false);
      }
    },
    [addLog, workspaceRoot]
  );

  const indexWorkspace = useCallback(async () => {
    setWorking(true);

    const a = api();
    const snapshots: Any[] = [];

    try {
      snapshots.push(await callAny(["runtime.snapshot"]));
    } catch (error) {
      snapshots.push({ runtimeError: String(error) });
    }

    try {
      snapshots.push(await callAny(["workspace.status"]));
    } catch (error) {
      snapshots.push({ workspaceStatusError: String(error) });
    }

    try {
      snapshots.push(await callAny(["workspace.tree"]));
    } catch (error) {
      snapshots.push({ workspaceTreeError: String(error) });
    }

    try {
      snapshots.push(await callAny(["workspace.scan"]));
    } catch (error) {
      snapshots.push({ workspaceScanError: String(error) });
    }

    try {
      snapshots.push(await callAny(["diagnostics.runtime"]));
    } catch (error) {
      snapshots.push({ diagnosticsError: String(error) });
    }

    const flat = flattenEntries(snapshots);
    const root = inferRoot(flat, snapshots);

    setRawSnapshots(snapshots);
    setEntries(flat);
    setWorkspaceRoot(root);
    setBridgeEntries(bridgeFunctions(a));

    addLog(`INDEX ${flat.length} entries / ${sourceFiles(flat).length} source files / bridge=${bridgeFunctions(a).length}`);

    const indexedFiles = sourceFiles(flat);
    const preferred =
      indexedFiles.find((entry) =>
        /packages\/adjutorix-app\/src\/renderer\/RevolutionWorkbench\.tsx$/.test(entry.path)
      ) ?? indexedFiles.at(0) ?? null;

    if (preferred && !selectedPath) {
      await openFile(preferred.path, root ?? undefined);
    }

    setWorking(false);
  }, [addLog, selectedPath]);

  const openWorkspace = useCallback(async () => {
    try {
      await callAny(["workspace.open"], [{ schema: 1, actor: "renderer", source: "ipc" }]);
      addLog("WORKSPACE OPEN COMPLETE");
    } catch (error) {
      addLog(`WORKSPACE OPEN FAILED ${String(error)}`);
    }

    await indexWorkspace();
  }, [addLog, indexWorkspace]);

  const openFile = useCallback(
    async (path: string, rootOverride?: string) => {
      const root = rootOverride ?? workspaceRoot ?? undefined;
      const absolute = cleanPath(path);
      const rel = relative(absolute, root);
      const entry = entries.find((e) => cleanPath(e.path) === absolute);

      if (entry?.isDir) {
        addLog(`SKIP DIRECTORY ${rel}`);
        return;
      }

      try {
        const payload = await callAny(["workspace.readFile"], [
          { schema: 1, actor: "renderer", path: rel, targetPath: rel, relativePath: rel, filePath: rel, workspacePath: rel },
          { path: rel },
        ]);

        const content = textFrom(payload);
        const resolved = cleanPath(asObject(payload).path ?? absolute);
        const state: BufferState = {
          path: resolved,
          content,
          original: content,
          language: language(resolved),
          dirty: false,
          openedAt: Date.now(),
        };

        setBuffers((prev) => ({ ...prev, [resolved]: state }));
        setSelectedPath(resolved);
        setOpenFiles((prev) => Array.from(new Set([...prev, resolved])));
        addLog(`OPEN ${relative(resolved, root)}`);
      } catch (error) {
        addLog(`OPEN FAILED ${rel} :: ${String(error)}`);
      }
    },
    [addLog, entries, workspaceRoot]
  );

  const saveFile = useCallback(
    async (path: string) => {
      const buffer = buffers[path];
      if (!buffer) return;

      const rel = relative(path, workspaceRoot);
      try {
        await callAny(["workspace.writeFile", "workspace.saveFile"], [
          {
            schema: 1,
            actor: "renderer",
            path: rel,
            targetPath: rel,
            relativePath: rel,
            filePath: rel,
            workspacePath: rel,
            content: buffer.content,
            text: buffer.content,
            value: buffer.content,
          },
          { path: rel, content: buffer.content },
        ]);

        setBuffers((prev) => ({
          ...prev,
          [path]: { ...buffer, original: buffer.content, dirty: false, savedAt: Date.now() },
        }));

        addLog(`SAVE ${rel}`);
      } catch (error) {
        addLog(`SAVE FAILED ${rel} :: ${String(error)}`);
      }
    },
    [addLog, buffers, workspaceRoot]
  );

  const saveAll = useCallback(async () => {
    for (const buffer of Object.values(buffers).filter((b) => b.dirty)) {
      await saveFile(buffer.path);
    }
  }, [buffers, saveFile]);

  const writeAgentHandoff = useCallback(async () => {
    const dirty = Object.values(buffers).filter((b) => b.dirty);
    const content = [
      "# ADJUTORIX Native Agent Context",
      "",
      `marker=${MARKER}`,
      `root=${workspaceRoot ?? ""}`,
      `intent=${agentIntent}`,
      `current=${current ? relative(current.path, workspaceRoot) : "none"}`,
      `dirty=${dirty.map((b) => relative(b.path, workspaceRoot)).join(",") || "none"}`,
      "",
      "## Capabilities",
      "",
      capabilityText,
      "",
      "## Current file",
      "",
      "```",
      current?.content?.slice(0, 30000) ?? "",
      "```",
      "",
      "## Recent activity",
      "",
      activity.slice(0, 120).join("\n"),
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
          content,
          text: content,
          value: content,
        },
      ]);
      addLog(`AGENT CONTEXT WRITTEN ${target}`);
      setRightMode("agent");
      return;
    } catch (error) {
      addLog(`WORKSPACE WRITE HANDOFF FALLBACK ${String(error)}`);
    }

    const encoded = encodeBase64Utf8(content);
    const command =
      "python3 - <<'PY'\n" +
      "from pathlib import Path\n" +
      "import base64\n" +
      `data=base64.b64decode('${encoded}').decode('utf-8')\n` +
      "p=Path('.adjutorix/native-agent-context.md')\n" +
      "p.parent.mkdir(parents=True, exist_ok=True)\n" +
      "p.write_text(data)\n" +
      "print(p)\n" +
      "PY";

    await runCommand(command, 30000);
  }, [activity, agentIntent, buffers, capabilityText, current, runCommand, workspaceRoot]);

  useEffect(() => {
    indexWorkspace();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "adjutorix.native.session.v8",
        JSON.stringify({
          selectedPath,
          openFiles,
          leftMode,
          rightMode,
          bottomMode,
          terminalCommand,
        })
      );
    } catch {
      // ignore
    }
  }, [selectedPath, openFiles, leftMode, rightMode, bottomMode, terminalCommand]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("adjutorix.native.session.v8") ?? "{}");
      if (saved.leftMode) setLeftMode(saved.leftMode);
      if (saved.rightMode) setRightMode(saved.rightMode);
      if (saved.bottomMode) setBottomMode(saved.bottomMode);
      if (saved.terminalCommand) setTerminalCommand(saved.terminalCommand);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteOpen(true);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (selectedPath) void saveFile(selectedPath);
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveAll();
      }

      if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveAll, saveFile, selectedPath]);

  const paletteItems = useMemo(() => {
    const fileItems = files.slice(0, 120).map((file) => ({
      label: relative(file.path, workspaceRoot),
      kind: "file",
      run: () => void openFile(file.path),
    }));

    const commandItems = QUICK_COMMANDS.map((cmd) => ({
      label: cmd.label,
      kind: cmd.group,
      run: () => {
        setTerminalCommand(String(cmd.command));
        void runCommand(String(cmd.command));
      },
    }));

    const q = paletteQuery.trim().toLowerCase();
    const all = [...commandItems, ...fileItems];
    return q ? all.filter((item) => item.label.toLowerCase().includes(q) || item.kind.toLowerCase().includes(q)) : all;
  }, [files, openFile, paletteQuery, runCommand, workspaceRoot]);

  const sidebar = () => {
    if (leftMode === "commands" || leftMode === "run" || leftMode === "tasks") {
      return (
        <div className="space-y-2">
          {QUICK_COMMANDS.filter((cmd) => leftMode !== "tasks" || ["build", "quality", "doctor"].includes(cmd.group)).map((cmd) => (
            <button
              key={cmd.id}
              onClick={() => {
                setTerminalCommand(String(cmd.command));
                void runCommand(String(cmd.command));
              }}
              className="block w-full rounded border border-zinc-800 bg-black p-3 text-left hover:border-emerald-800"
            >
              <div className="text-xs font-semibold text-zinc-100">{cmd.label}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-emerald-500">{cmd.group}</div>
              <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{cmd.command}</div>
            </button>
          ))}
        </div>
      );
    }

    if (leftMode === "scm") {
      return (
        <div className="space-y-2">
          {QUICK_COMMANDS.filter((cmd) => cmd.group === "scm").map((cmd) => (
            <button
              key={cmd.id}
              onClick={() => {
                setTerminalCommand(String(cmd.command));
                void runCommand(String(cmd.command));
              }}
              className="block w-full rounded border border-zinc-800 bg-black p-3 text-left hover:border-emerald-800"
            >
              <div className="text-xs font-semibold text-zinc-100">{cmd.label}</div>
              <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{cmd.command}</div>
            </button>
          ))}
          <div className="rounded border border-zinc-900 bg-black p-3 text-xs text-zinc-500">
            SCM is native: status, diff, timeline. No delegation path.
          </div>
        </div>
      );
    }

    if (leftMode === "runtime") {
      return (
        <div className="space-y-1 font-mono text-[11px] text-zinc-400">
          {bridgeEntries.map((entry) => (
            <button key={entry} className="block w-full truncate rounded bg-black px-2 py-1 text-left hover:bg-zinc-900">
              {entry}
            </button>
          ))}
        </div>
      );
    }

    if (leftMode === "agent") {
      return (
        <div className="space-y-2 text-xs">
          <button onClick={() => void writeAgentHandoff()} className="w-full rounded bg-emerald-900 px-3 py-2 hover:bg-emerald-800">
            Write agent context
          </button>
          <button
            onClick={() => navigator.clipboard?.writeText(JSON.stringify({ root: workspaceRoot, current: current?.path, intent: agentIntent }, null, 2))}
            className="w-full rounded bg-zinc-800 px-3 py-2 hover:bg-zinc-700"
          >
            Copy minimal context
          </button>
          <div className="rounded border border-zinc-800 bg-black p-3 text-zinc-400">
            Agent is not decoration. It writes `.adjutorix/native-agent-context.md` through workspace.writeFile or shell.execute.
          </div>
        </div>
      );
    }

    return files.map((file) => (
      <button
        key={file.path}
        title={file.path}
        onClick={() => void openFile(file.path)}
        className={[
          "block w-full truncate rounded px-2 py-1.5 text-left text-xs",
          selectedPath === file.path ? "bg-emerald-950 text-emerald-100" : "text-zinc-300 hover:bg-zinc-900",
        ].join(" ")}
      >
        <span className="mr-2 text-zinc-600">{buffers[file.path]?.dirty ? "●" : "·"}</span>
        {relative(file.path, workspaceRoot)}
      </button>
    ));
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#050607] text-zinc-100">
      <div className="grid h-full grid-rows-[42px_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded border border-emerald-700 bg-emerald-950/50 px-2 py-1 text-[11px] font-bold text-emerald-200">
              {MARKER}
            </div>
            <button onClick={() => setPaletteOpen(true)} className="rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
              ⌘P command palette
            </button>
            <div className="truncate text-xs text-zinc-500">{workspaceRoot ?? "workspace root unknown"}</div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded border border-zinc-800 px-2 py-1 text-zinc-400">bridge {bridgeEntries.length}</span>
            <span className="rounded border border-zinc-800 px-2 py-1 text-zinc-400">dirty {dirtyCount}</span>
            <button onClick={() => void openWorkspace()} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">
              Open workspace
            </button>
            <button onClick={() => void indexWorkspace()} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">
              {working ? "Working..." : "Index"}
            </button>
            <button
              disabled={!current?.dirty}
              onClick={() => current && void saveFile(current.path)}
              className="rounded bg-emerald-900 px-3 py-1.5 enabled:hover:bg-emerald-800 disabled:opacity-40"
            >
              Save
            </button>
            <button
              disabled={!dirtyCount}
              onClick={() => void saveAll()}
              className="rounded bg-emerald-900 px-3 py-1.5 enabled:hover:bg-emerald-800 disabled:opacity-40"
            >
              Save all
            </button>
          </div>
        </header>

        <main className="grid min-h-0 grid-cols-[38px_330px_minmax(0,1fr)_360px]">
          <nav className="border-r border-zinc-900 bg-black p-1">
            {[
              ["explorer", "EX"],
              ["search", "SE"],
              ["scm", "SC"],
              ["commands", "CM"],
              ["run", "RU"],
              ["tasks", "TK"],
              ["agent", "AG"],
              ["runtime", "RT"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setLeftMode(String(id))}
                className={[
                  "mb-1 h-8 w-8 rounded text-[11px]",
                  leftMode === id ? "bg-emerald-950 text-emerald-200" : "bg-zinc-950 text-zinc-500 hover:bg-zinc-900",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </nav>

          <aside className="grid min-h-0 grid-rows-[92px_minmax(0,1fr)] border-r border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 p-3">
              <div className="mb-2 flex justify-between text-xs">
                <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">{leftMode}</span>
                <span className="text-zinc-500">
                  {files.length}/{sourceFiles(entries).length}
                </span>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="search files + loaded content"
                className="w-full rounded border border-zinc-800 bg-black px-3 py-2 text-xs outline-none focus:border-emerald-700"
              />
            </div>

            <div className="min-h-0 overflow-auto p-2">{sidebar()}</div>
          </aside>

          <section className="grid min-h-0 grid-rows-[34px_minmax(0,1fr)_260px]">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2">
              {openFiles.length === 0 ? (
                <span className="text-xs text-zinc-600">Open a real source file.</span>
              ) : (
                openFiles.map((path) => (
                  <button
                    key={path}
                    onClick={() => setSelectedPath(path)}
                    className={[
                      "h-7 max-w-72 truncate rounded px-3 text-xs",
                      selectedPath === path ? "bg-zinc-800 text-zinc-100" : "bg-black text-zinc-400 hover:bg-zinc-900",
                    ].join(" ")}
                    title={path}
                  >
                    {buffers[path]?.dirty ? "● " : ""}
                    {baseName(path)}
                  </button>
                ))
              )}
            </div>

            <div className="min-h-0">
              {current ? (
                <Editor
                  height="100%"
                  theme="vs-dark"
                  path={current.path}
                  language={current.language}
                  value={current.content}
                  options={{
                    automaticLayout: true,
                    fontSize: 13,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    renderWhitespace: "selection",
                    wordWrap: "off",
                  }}
                  onChange={(value) => {
                    const next = value ?? "";
                    setBuffers((prev) => {
                      const existing = prev[current.path];
                      if (!existing) return prev;
                      return {
                        ...prev,
                        [current.path]: {
                          ...existing,
                          content: next,
                          dirty: next !== existing.original,
                        },
                      };
                    });
                  }}
                />
              ) : (
                <div className="grid h-full place-items-center text-sm text-zinc-600">No file selected.</div>
              )}
            </div>

            <div className="min-h-0 border-t border-zinc-800 bg-black">
              <div className="flex h-8 items-center justify-between border-b border-zinc-900 px-2">
                <div className="flex gap-3 text-xs">
                  {["terminal", "output", "problems", "patch", "raw"].map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setBottomMode(mode)}
                      className={bottomMode === mode ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-300"}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <button onClick={() => setBottomMode("terminal")} className="text-xs text-zinc-500">
                  Bottom
                </button>
              </div>

              {bottomMode === "terminal" && (
                <div className="grid h-[calc(100%-32px)] grid-rows-[34px_minmax(0,1fr)]">
                  <div className="flex gap-2 p-2">
                    <input
                      value={terminalCommand}
                      onChange={(event) => setTerminalCommand(event.target.value)}
                      className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs outline-none focus:border-emerald-700"
                    />
                    <button onClick={() => void runCommand(terminalCommand)} className="rounded bg-zinc-800 px-4 text-xs hover:bg-zinc-700">
                      Run
                    </button>
                  </div>
                  <pre className="overflow-auto px-3 pb-3 font-mono text-xs leading-5 text-zinc-300">{JSON.stringify(terminalOutput, null, 2)}</pre>
                </div>
              )}

              {bottomMode === "output" && (
                <pre className="h-[calc(100%-32px)] overflow-auto p-3 font-mono text-xs text-zinc-300">{outputLog.join("\n")}</pre>
              )}

              {bottomMode === "problems" && (
                <div className="h-[calc(100%-32px)] overflow-auto p-3 text-xs">
                  {problems.length === 0 ? (
                    <div className="text-zinc-500">No problems parsed.</div>
                  ) : (
                    problems.map((problem, index) => (
                      <div key={index} className="mb-2 rounded border border-zinc-900 bg-zinc-950 p-2">
                        <div className={problem.severity === "error" ? "text-red-300" : "text-yellow-300"}>{problem.severity.toUpperCase()}</div>
                        <div className="font-mono text-zinc-400">
                          {problem.file ?? ""}
                          {problem.line ? `:${problem.line}:${problem.column ?? 1}` : ""}
                        </div>
                        <div>{problem.message}</div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {bottomMode === "patch" && <pre className="h-[calc(100%-32px)] overflow-auto p-3 font-mono text-xs text-zinc-300">{currentPatch}</pre>}

              {bottomMode === "raw" && (
                <pre className="h-[calc(100%-32px)] overflow-auto p-3 font-mono text-xs text-zinc-300">{JSON.stringify(rawSnapshots, null, 2)}</pre>
              )}
            </div>
          </section>

          <aside className="grid min-h-0 grid-rows-[36px_minmax(0,1fr)] border-l border-zinc-800 bg-zinc-950">
            <div className="flex items-center gap-3 overflow-x-auto border-b border-zinc-800 px-2 text-xs">
              {["inspector", "outline", "problems", "patch", "agent", "runtime", "capabilities"].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setRightMode(mode)}
                  className={rightMode === mode ? "rounded bg-zinc-800 px-2 py-1 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="min-h-0 overflow-auto p-3 text-xs">
              {rightMode === "inspector" && (
                <div className="space-y-3">
                  <div className="rounded border border-zinc-800 bg-black p-3">
                    <div className="text-zinc-500">Current file</div>
                    <div className="mt-1 break-all font-mono text-emerald-300">{current ? relative(current.path, workspaceRoot) : "none"}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["entries", entries.length],
                      ["files", sourceFiles(entries).length],
                      ["open", openFiles.length],
                      ["dirty", dirtyCount],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded border border-zinc-800 bg-black p-3">
                        <div className="text-zinc-500">{label}</div>
                        <div className="text-lg">{value}</div>
                      </div>
                    ))}
                  </div>
                  <button
                    disabled={!current?.dirty}
                    onClick={() =>
                      current &&
                      setBuffers((prev) => ({
                        ...prev,
                        [current.path]: { ...current, content: current.original, dirty: false },
                      }))
                    }
                    className="w-full rounded bg-zinc-800 px-3 py-2 disabled:opacity-40"
                  >
                    Revert current
                  </button>
                </div>
              )}

              {rightMode === "outline" && (
                <div className="space-y-2">
                  {currentOutline.length === 0 ? (
                    <div className="text-zinc-500">No symbols.</div>
                  ) : (
                    currentOutline.map((item) => (
                      <div key={`${item.line}:${item.name}`} className="rounded border border-zinc-900 bg-black p-2">
                        <div className="text-emerald-300">{item.kind}</div>
                        <div className="font-mono text-zinc-300">{item.name}</div>
                        <div className="text-zinc-600">line {item.line}</div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {rightMode === "problems" && (
                <div className="space-y-2">
                  {problems.length === 0 ? (
                    <div className="text-zinc-500">No problems.</div>
                  ) : (
                    problems.map((problem, index) => (
                      <div key={index} className="rounded border border-zinc-900 bg-black p-2">
                        <div className={problem.severity === "error" ? "text-red-300" : "text-yellow-300"}>{problem.severity}</div>
                        <div className="font-mono text-zinc-400">
                          {problem.file ?? ""}
                          {problem.line ? `:${problem.line}` : ""}
                        </div>
                        <div>{problem.message}</div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {rightMode === "patch" && <pre className="whitespace-pre-wrap rounded border border-zinc-900 bg-black p-3 font-mono text-[11px] text-zinc-300">{currentPatch}</pre>}

              {rightMode === "agent" && (
                <div className="space-y-3">
                  <textarea
                    value={agentIntent}
                    onChange={(event) => setAgentIntent(event.target.value)}
                    className="h-32 w-full rounded border border-zinc-700 bg-black p-3 outline-none focus:border-emerald-700"
                  />
                  <button onClick={() => void writeAgentHandoff()} className="w-full rounded bg-emerald-900 px-3 py-2 hover:bg-emerald-800">
                    Write real handoff file
                  </button>
                  <button
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify({ root: workspaceRoot, current: current?.path, intent: agentIntent }, null, 2))}
                    className="w-full rounded bg-zinc-800 px-3 py-2 hover:bg-zinc-700"
                  >
                    Copy context
                  </button>
                  <pre className="max-h-[520px] overflow-auto rounded border border-zinc-800 bg-black p-3 font-mono text-[11px] text-zinc-400">
                    {[
                      "ADJUTORIX_NATIVE_AGENT_CONTEXT",
                      `ROOT=${workspaceRoot ?? ""}`,
                      `DIRTY_FILES=${Object.values(buffers).filter((b) => b.dirty).map((b) => relative(b.path, workspaceRoot)).join(",") || "none"}`,
                      `INTENT=${agentIntent}`,
                      `CURRENT_FILE=${current ? relative(current.path, workspaceRoot) : "none"}`,
                      "",
                      (current?.content ?? "").slice(0, 12000),
                    ].join("\n")}
                  </pre>
                </div>
              )}

              {rightMode === "runtime" && (
                <div className="space-y-2">
                  <div className="rounded border border-zinc-800 bg-black p-3">
                    <div className="text-zinc-500">Detected bridge functions</div>
                    <div className="text-2xl text-emerald-300">{bridgeEntries.length}</div>
                  </div>
                  <div className="space-y-1 font-mono text-[11px] text-zinc-400">
                    {bridgeEntries.map((entry) => (
                      <div key={entry} className="rounded bg-black px-2 py-1">
                        {entry}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {rightMode === "capabilities" && (
                <div className="space-y-2">
                  {CAPABILITIES.map(([name, value]) => (
                    <div key={name} className="rounded border border-zinc-900 bg-black p-3">
                      <div className="text-emerald-300">{name}</div>
                      <div className="mt-1 text-zinc-400">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>

      {paletteOpen && (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/70 pt-24">
          <div className="mx-auto w-[760px] rounded-xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl">
            <input
              autoFocus
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder="Type command or file..."
              className="mb-3 w-full rounded border border-emerald-800 bg-black px-3 py-3 text-sm outline-none"
            />
            <div className="max-h-[520px] overflow-auto">
              {paletteItems.slice(0, 80).map((item, index) => (
                <button
                  key={`${item.kind}:${item.label}:${index}`}
                  onClick={() => {
                    item.run();
                    setPaletteOpen(false);
                    setPaletteQuery("");
                  }}
                  className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-zinc-900"
                >
                  <span>{item.label}</span>
                  <span className="text-xs text-zinc-500">{item.kind}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

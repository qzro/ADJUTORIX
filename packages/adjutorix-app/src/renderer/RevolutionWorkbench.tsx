// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";

const MARKER = "ADJUTORIX_NATIVE_IDE_WORKBENCH_V7";

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
  message: string;
  severity: "error" | "warning" | "info";
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

const QUICK_COMMANDS = [
  { id: "self", label: "Self-test", command: "echo ADJUTORIX_COMMAND_BRIDGE_OK && pwd && git status --short | head -80" },
  { id: "build", label: "Build app", command: "pnpm --filter @adjutorix/app run build" },
  { id: "typecheck", label: "Typecheck", command: "pnpm --filter @adjutorix/app exec tsc -p tsconfig.json --noEmit --pretty false" },
  { id: "verify", label: "Verify", command: "pnpm run verify" },
  { id: "test", label: "Test", command: "pnpm test" },
  { id: "status", label: "Git status", command: "git status --short" },
  { id: "diff", label: "Git diff", command: "git diff --stat && git diff -- packages/adjutorix-app/src/renderer/RevolutionWorkbench.tsx | head -240" },
  { id: "search-todos", label: "TODO/FIXME", command: "rg -n \"TODO|FIXME|throw new Error|bridge_missing|placeholder|mock|stub\" packages configs scripts src 2>/dev/null | head -240" },
];

function getApi(): Any {
  const w = window as Any;
  const raw = w.adjutorix ?? {};
  const exposed = w.adjutorixApi ?? {};
  return {
    ...exposed,
    ...raw,
    shell: raw.shell ?? exposed.shell,
    command: raw.command ?? exposed.command,
    commands: raw.commands ?? exposed.commands,
    terminal: raw.terminal ?? exposed.terminal,
    workspace: { ...(exposed.workspace ?? {}), ...(raw.workspace ?? {}) },
    runtime: { ...(exposed.runtime ?? {}), ...(raw.runtime ?? {}) },
    diagnostics: { ...(exposed.diagnostics ?? {}), ...(raw.diagnostics ?? {}) },
    verify: { ...(exposed.verify ?? {}), ...(raw.verify ?? {}) },
    patch: { ...(exposed.patch ?? {}), ...(raw.patch ?? {}) },
    ledger: { ...(exposed.ledger ?? {}), ...(raw.ledger ?? {}) },
    agent: { ...(exposed.agent ?? {}), ...(raw.agent ?? {}) },
  };
}

function zpath(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function basename(value: unknown): string {
  const parts = zpath(value).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? String(value ?? "");
}

function dirname(value: unknown): string {
  const parts = zpath(value).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function relpath(path: string, root: string | null): string {
  const p = zpath(path);
  const r = zpath(root);
  if (!r) return p;
  if (p === r) return ".";
  if (p.startsWith(r + "/")) return p.slice(r.length + 1);
  return p;
}

function quote(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function obj(value: unknown): Record<string, Any> {
  return value && typeof value === "object" ? (value as Record<string, Any>) : {};
}

function unwrap(value: Any): Any {
  const v = obj(value);
  if (v.ok === true && "data" in v) return v.data;
  if (v.ok === true && "result" in v) return v.result;
  if (v.ok === true && "snapshot" in v) return v.snapshot;
  return value;
}

function getAt(root: Any, path: string): Any {
  let cur = root;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return cur;
}

async function callAny(paths: string[], payloads: Any[] = [{}]): Promise<Any> {
  const a = getApi();
  let sawFunction = false;
  let lastError: unknown = null;

  for (const path of paths) {
    const fn = getAt(a, path);
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

  throw sawFunction
    ? lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "bridge_call_failed"))
    : new Error(`bridge_missing:${paths.join("|")}`);
}

function listFunctions(root: Any): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();

  const walk = (value: Any, prefix: string[], depth: number) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 7) return;
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
      const path = [...prefix, key];
      if (typeof child === "function") out.push(path.join("."));
      else if (child && typeof child === "object") walk(child, path, depth + 1);
    }
  };

  walk(root, [], 0);
  return out.sort();
}

function collectArrays(value: Any): Any[] {
  const out: Any[] = [];
  const seen = new Set<unknown>();

  const walk = (node: Any) => {
    const n = unwrap(node);
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);

    if (Array.isArray(n)) {
      out.push(n);
      n.forEach(walk);
      return;
    }

    for (const child of Object.values(n)) walk(child);
  };

  walk(value);
  return out;
}

function pathFromUnknown(value: Any): string | null {
  const v = obj(value);
  const p = v.path ?? v.fullPath ?? v.absolutePath ?? v.relativePath ?? v.workspacePath ?? v.filePath ?? v.id;
  return typeof p === "string" && p.trim() ? zpath(p) : null;
}

function isDirUnknown(value: Any): boolean {
  const v = obj(value);
  const kind = String(v.kind ?? v.type ?? v.entryType ?? "").toLowerCase();
  return v.isDirectory === true || v.directory === true || kind.includes("dir") || kind.includes("folder");
}

function collectEntries(values: Any[]): Entry[] {
  const map = new Map<string, Entry>();

  const walk = (node: Any) => {
    const n = unwrap(node);
    if (!n || typeof n !== "object") return;

    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }

    const p = pathFromUnknown(n);
    if (p) {
      const entry: Entry = {
        path: p,
        isDir: isDirUnknown(n),
        size: typeof n.size === "number" ? n.size : undefined,
      };
      map.set(`${entry.isDir ? "d" : "f"}:${entry.path}`, entry);
    }

    for (const key of ["children", "entries", "items", "files", "tree", "workspaceTree", "fileTree"]) {
      if (Array.isArray(n[key])) n[key].forEach(walk);
    }

    for (const key of ["workspace", "data", "snapshot", "runtime", "root", "result"]) {
      if (n[key]) walk(n[key]);
    }
  };

  values.forEach(walk);
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function noise(path: string): boolean {
  const p = `/${zpath(path).toLowerCase()}/`;
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
  const p = zpath(path).toLowerCase();
  const b = basename(p);
  let s = 0;

  if (p.endsWith("/packages/adjutorix-app/src/renderer/revolutionworkbench.tsx")) s += 600000;
  if (p.endsWith("/packages/adjutorix-app/src/preload/preload.ts")) s += 580000;
  if (p.endsWith("/packages/adjutorix-app/src/main/index.ts")) s += 560000;
  if (p.endsWith("/packages/adjutorix-app/src/renderer/main.tsx")) s += 540000;
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

  return s - Math.min(p.length, 900);
}

function rankFiles(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];

  for (const e of entries) {
    const p = zpath(e.path);
    if (!p || e.isDir || noise(p) || binary(p) || seen.has(p)) continue;
    seen.add(p);
    out.push({ ...e, path: p, score: score(p) });
  }

  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.path.localeCompare(b.path));
}

function findRoot(entries: Entry[], snapshots: Any[]): string | null {
  for (const snap of snapshots) {
    let root: string | null = null;
    const walk = (v: Any) => {
      const n = unwrap(v);
      if (!n || typeof n !== "object" || root) return;
      for (const key of ["rootPath", "workspaceRoot", "workspacePath", "repoPath", "cwd"]) {
        if (typeof n[key] === "string" && n[key].trim()) root = zpath(n[key]);
      }
      if (Array.isArray(n)) n.forEach(walk);
      else Object.values(n).forEach(walk);
    };
    walk(snap);
    if (root) return root;
  }

  const all = entries.map((e) => zpath(e.path));
  for (const marker of ["/packages/", "/configs/", "/scripts/", "/tests/", "/docs/"]) {
    const hit = all.find((p) => p.includes(marker));
    if (hit) return hit.slice(0, hit.indexOf(marker));
  }
  return null;
}

function normalizeShellResult(value: Any, command: string): Any {
  const v = obj(unwrap(value));
  if ("stdout" in v || "stderr" in v || "exitCode" in v || "status" in v) return v;
  return { ok: true, status: "ok", command, stdout: typeof value === "string" ? value : JSON.stringify(value, null, 2), stderr: "" };
}

function parseProblems(text: string): Problem[] {
  const lines = String(text ?? "").split(/\r?\n/);
  const out: Problem[] = [];

  for (const line of lines) {
    let m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
    if (m) {
      out.push({ file: m[1], line: Number(m[2]), column: Number(m[3]), severity: "error", message: `${m[4]} ${m[5]}` });
      continue;
    }

    m = line.match(/^(.+?):(\d+):(\d+):\s+(error|warning):\s+(.+)$/i);
    if (m) {
      out.push({ file: m[1], line: Number(m[2]), column: Number(m[3]), severity: m[4].toLowerCase() === "warning" ? "warning" : "error", message: m[5] });
      continue;
    }

    if (/error|failed|exception/i.test(line)) out.push({ severity: "error", message: line });
  }

  return out.slice(0, 300);
}

function outline(content: string) {
  const rows: Array<{ line: number; kind: string; name: string }> = [];
  const patterns = [
    [/^\s*export\s+default\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*async\s+function\s+([A-Za-z0-9_$]+)/, "function"],
    [/^\s*class\s+([A-Za-z0-9_$]+)/, "class"],
    [/^\s*const\s+([A-Za-z0-9_$]+)\s*=/, "const"],
    [/^\s*def\s+([A-Za-z0-9_]+)/, "function"],
    [/^\s*class\s+([A-Za-z0-9_]+)/, "class"],
    [/^\s*#{1,6}\s+(.+)/, "section"],
  ] as const;

  content.split(/\r?\n/).forEach((line, i) => {
    for (const [re, kind] of patterns) {
      const m = line.match(re);
      if (m) {
        rows.push({ line: i + 1, kind, name: m[1] });
        break;
      }
    }
  });

  return rows.slice(0, 200);
}

function makePatch(original: string, current: string): string {
  if (original === current) return "No patch.";
  const a = original.split(/\r?\n/);
  const b = current.split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  const out = ["--- original", "+++ current"];

  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`-${String(i + 1).padStart(4, " ")} ${a[i]}`);
    if (b[i] !== undefined) out.push(`+${String(i + 1).padStart(4, " ")} ${b[i]}`);
    if (out.length > 500) {
      out.push("[patch truncated]");
      break;
    }
  }

  return out.join("\n");
}

export default function RevolutionWorkbench() {
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, BufferState>>({});
  const [openOrder, setOpenOrder] = useState<string[]>([]);
  const [rightTab, setRightTab] = useState("inspector");
  const [bottomTab, setBottomTab] = useState("terminal");
  const [activity, setActivity] = useState("explorer");
  const [terminalCommand, setTerminalCommand] = useState("pnpm --filter @adjutorix/app run build");
  const [terminalOutput, setTerminalOutput] = useState<Any>({ status: "ready", stdout: "Run a command. Primary substrate: shell.execute. Fallbacks: shell.run / command.run / terminal.execute / runtime.runCommand. CSS pipeline: native-workbench.css.", stderr: "" });
  const [snapshots, setSnapshots] = useState<Any[]>([]);
  const [functions, setFunctions] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [agentIntent, setAgentIntent] = useState("Inspect current workspace state and propose the next concrete patch.");
  const [busy, setBusy] = useState(false);

  const current = selected ? buffers[selected] : null;
  const visibleFiles = useMemo(() => {
    const files = rankFiles(entries);
    const q = query.trim().toLowerCase();
    if (!q) return files.slice(0, 900);

    return files
      .filter((e) => relpath(e.path, root).toLowerCase().includes(q) || String(buffers[e.path]?.content ?? "").toLowerCase().includes(q))
      .slice(0, 900);
  }, [entries, query, root, buffers]);

  const dirtyCount = useMemo(() => Object.values(buffers).filter((b) => b.dirty).length, [buffers]);

  const currentOutline = useMemo(() => outline(current?.content ?? ""), [current?.content]);
  const currentPatch = useMemo(() => (current ? makePatch(current.original, current.content) : "No file."), [current]);

  const addLog = useCallback((line: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 400));
  }, []);

  const runCommand = useCallback(
    async (command: string, options: Any = {}) => {
      setBusy(true);
      setBottomTab("terminal");
      addLog(`RUN ${command}`);
      try {
        const result = normalizeShellResult(
          await callAny(COMMAND_BRIDGES, [
            { schema: 1, actor: "renderer", command, intent: command, cwd: root ?? undefined, timeoutMs: options.timeoutMs ?? 180000 },
            { command, cwd: root ?? undefined },
            command,
          ]),
          command,
        );

        setTerminalOutput(result);
        const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
        const parsed = parseProblems(text);
        if (parsed.length) setProblems(parsed);
        addLog(`${result.status ?? "done"} exit=${result.exitCode ?? "?"}`);
        return result;
      } catch (error) {
        const result = { ok: false, status: "bridge_error", command, stderr: error instanceof Error ? error.message : String(error), stdout: "" };
        setTerminalOutput(result);
        setProblems(parseProblems(result.stderr));
        addLog(`BLOCKED ${result.stderr}`);
        return result;
      } finally {
        setBusy(false);
      }
    },
    [addLog, root],
  );

  const indexWorkspace = useCallback(async () => {
    const result = await runCommand(
      "git ls-files | sed -n '1,2000p' || find . -maxdepth 7 -type f | sed 's#^./##' | sed -n '1,2000p'",
      { timeoutMs: 60000 },
    );

    const stdout = String(result.stdout ?? "");
    const files = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((path) => ({ path, isDir: false }));

    if (files.length) {
      setEntries((prev) => {
        const map = new Map<string, Entry>();
        for (const e of [...prev, ...files]) map.set(e.path, e);
        return [...map.values()];
      });
      addLog(`INDEX ${files.length} source files`);
    }
  }, [addLog, runCommand]);

  const refresh = useCallback(async () => {
    setBusy(true);
    const a = getApi();
    const nextSnapshots: Any[] = [];
    const calls: Array<[string, () => Promise<Any>]> = [
      ["runtime.snapshot", () => callAny(["runtime.snapshot"])],
      ["workspace.health", () => callAny(["workspace.health"])],
      ["diagnostics.runtime", () => callAny(["diagnostics.runtime"])],
      ["ledger.current", () => callAny(["ledger.current"])],
      ["agent.status", () => callAny(["agent.status"])],
    ];

    for (const [name, fn] of calls) {
      try {
        nextSnapshots.push({ name, value: await fn() });
      } catch (error) {
        nextSnapshots.push({ name, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const bridgeFunctions = listFunctions(a);
    const bridgeEntries = collectEntries(nextSnapshots);
    const inferredRoot = findRoot(bridgeEntries, nextSnapshots);
    if (inferredRoot) setRoot(inferredRoot);
    setSnapshots(nextSnapshots);
    setFunctions(bridgeFunctions);

    setEntries((prev) => {
      const map = new Map<string, Entry>();
      for (const e of [...prev, ...bridgeEntries]) map.set(e.path, e);
      return [...map.values()];
    });

    addLog(`REFRESH bridge=${bridgeFunctions.length} entries=${bridgeEntries.length}`);
    setBusy(false);

    if (bridgeEntries.length < 20) void indexWorkspace();
  }, [addLog, indexWorkspace]);

  const openFile = useCallback(
    async (path: string) => {
      const p = zpath(path);
      if (!p || noise(p) || binary(p)) return;

      if (buffers[p]) {
        setSelected(p);
        setOpenOrder((prev) => [...prev.filter((x) => x !== p), p]);
        return;
      }

      setBusy(true);
      try {
        let content = "";
        try {
          const data = await callAny(
            ["workspace.readFile", "workspace.file.read", "workspace.read"],
            [
              { schema: 1, actor: "renderer", path: relpath(p, root), targetPath: relpath(p, root), relativePath: relpath(p, root), filePath: relpath(p, root) },
              { path: relpath(p, root) },
              relpath(p, root),
            ],
          );
          content = String(obj(data).content ?? obj(data).text ?? obj(data).value ?? data ?? "");
        } catch {
          const cmd = `python3 - <<'PY'\nfrom pathlib import Path\np=Path(${JSON.stringify(relpath(p, root))})\nprint(p.read_text(errors='replace'), end='')\nPY`;
          const result = await runCommand(cmd, { timeoutMs: 30000 });
          content = String(result.stdout ?? "");
        }

        const buffer: BufferState = {
          path: p,
          content,
          original: content,
          language: language(p),
          dirty: false,
          openedAt: Date.now(),
        };

        setBuffers((prev) => ({ ...prev, [p]: buffer }));
        setOpenOrder((prev) => [...prev.filter((x) => x !== p), p]);
        setSelected(p);
        addLog(`OPEN ${relpath(p, root)}`);
      } catch (error) {
        addLog(`OPEN FAILED ${relpath(p, root)} ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [addLog, buffers, root, runCommand],
  );

  const saveFile = useCallback(
    async (path: string) => {
      const b = buffers[path];
      if (!b) return;

      const relative = relpath(path, root);
      const encoded = btoa(unescape(encodeURIComponent(b.content)));
      const cmd = [
        "python3 - <<'PY'",
        "from pathlib import Path",
        "import base64",
        `p=Path(${JSON.stringify(relative)})`,
        "p.parent.mkdir(parents=True, exist_ok=True)",
        `p.write_text(base64.b64decode(${JSON.stringify(encoded)}).decode('utf-8'), encoding='utf-8')`,
        "print(str(p))",
        "PY",
      ].join("\n");

      const result = await runCommand(cmd, { timeoutMs: 30000 });
      if (result.ok === true || result.status === "ok") {
        setBuffers((prev) => {
          const cur = prev[path];
          if (!cur) return prev;
          return { ...prev, [path]: { ...cur, original: cur.content, dirty: false, savedAt: Date.now() } };
        });
        addLog(`SAVE ${relative}`);
      }
    },
    [addLog, buffers, root, runCommand],
  );

  const saveAll = useCallback(async () => {
    for (const b of Object.values(buffers)) {
      if (b.dirty) await saveFile(b.path);
    }
  }, [buffers, saveFile]);

  const writeAgentHandoff = useCallback(async () => {
    const context = [
      "ADJUTORIX_NATIVE_AGENT_CONTEXT",
      `ROOT=${root ?? ""}`,
      `DIRTY_FILES=${Object.values(buffers).filter((b) => b.dirty).map((b) => relpath(b.path, root)).join(",") || "none"}`,
      `INTENT=${agentIntent}`,
      `CURRENT_FILE=${current ? relpath(current.path, root) : "none"}`,
      "",
      "```",
      current?.content?.slice(0, 20000) ?? "",
      "```",
      "",
      "BRIDGE_FUNCTIONS=",
      functions.join("\n"),
      "",
      "RECENT_LOGS=",
      logs.slice(0, 40).join("\n"),
    ].join("\n");

    const encoded = btoa(unescape(encodeURIComponent(context)));
    const cmd = [
      "python3 - <<'PY'",
      "from pathlib import Path",
      "import base64",
      "p=Path('.adjutorix/native-agent-context.md')",
      "p.parent.mkdir(parents=True, exist_ok=True)",
      `p.write_text(base64.b64decode(${JSON.stringify(encoded)}).decode('utf-8'), encoding='utf-8')`,
      "print('HANDOFF_WRITTEN=' + str(p))",
      "print('NEXT=open this file in the agent or feed it to your local model runner')",
      "PY",
    ].join("\n");

    const result = await runCommand(cmd, { timeoutMs: 30000 });
    addLog(`AGENT HANDOFF ${result.status ?? "done"}`);
  }, [agentIntent, buffers, current, functions, logs, root, runCommand, addLog]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (selected) void saveFile(selected);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, saveFile]);

  const paletteItems = useMemo(() => {
    const fileItems = visibleFiles.slice(0, 80).map((f) => ({
      label: relpath(f.path, root),
      kind: "file",
      run: () => void openFile(f.path),
    }));

    const commandItems = QUICK_COMMANDS.map((c) => ({
      label: c.label,
      kind: "command",
      run: () => {
        setTerminalCommand(c.command);
        void runCommand(c.command);
      },
    }));

    return [...commandItems, ...fileItems];
  }, [openFile, root, runCommand, visibleFiles]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#050607] text-zinc-100">
      <div className="grid h-full grid-rows-[42px_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded border border-emerald-700 bg-emerald-950/50 px-2 py-1 text-[11px] font-bold text-emerald-200">{MARKER}</div>
            <button onClick={() => setPaletteOpen(true)} className="rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">⌘P command palette</button>
            <div className="truncate text-xs text-zinc-500">{root ?? "workspace root unknown"}</div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded border border-zinc-800 px-2 py-1 text-zinc-400">bridge {functions.length}</span>
            <span className="rounded border border-zinc-800 px-2 py-1 text-zinc-400">dirty {dirtyCount}</span>
            <button onClick={() => void refresh()} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">{busy ? "Working..." : "Refresh"}</button>
            <button onClick={() => void indexWorkspace()} className="rounded bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">Index</button>
            <button disabled={!current || !current.dirty} onClick={() => current && void saveFile(current.path)} className="rounded bg-emerald-900 px-3 py-1.5 enabled:hover:bg-emerald-800 disabled:opacity-40">Save</button>
            <button disabled={!dirtyCount} onClick={() => void saveAll()} className="rounded bg-emerald-900 px-3 py-1.5 enabled:hover:bg-emerald-800 disabled:opacity-40">Save all</button>
          </div>
        </header>

        <main className="grid min-h-0 grid-cols-[38px_330px_minmax(0,1fr)_360px]">
          <nav className="border-r border-zinc-900 bg-black p-1">
            {[
              ["explorer", "EX"],
              ["search", "SE"],
              ["commands", "CM"],
              ["run", "RU"],
              ["agent", "AG"],
              ["runtime", "RT"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActivity(id)}
                className={[
                  "mb-1 h-8 w-8 rounded text-[11px]",
                  activity === id ? "bg-emerald-950 text-emerald-200" : "bg-zinc-950 text-zinc-500 hover:bg-zinc-900",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </nav>

          <aside className="grid min-h-0 grid-rows-[92px_minmax(0,1fr)] border-r border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 p-3">
              <div className="mb-2 flex justify-between text-xs">
                <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">{activity}</span>
                <span className="text-zinc-500">{visibleFiles.length}/{rankFiles(entries).length}</span>
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search files + loaded content"
                className="w-full rounded border border-zinc-800 bg-black px-3 py-2 text-xs outline-none focus:border-emerald-700"
              />
            </div>

            <div className="min-h-0 overflow-auto p-2">
              {activity === "commands" || activity === "run" ? (
                <div className="space-y-2">
                  {QUICK_COMMANDS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setTerminalCommand(c.command);
                        void runCommand(c.command);
                      }}
                      className="block w-full rounded border border-zinc-800 bg-black p-3 text-left hover:border-emerald-800"
                    >
                      <div className="text-xs font-semibold text-zinc-100">{c.label}</div>
                      <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{c.command}</div>
                    </button>
                  ))}
                </div>
              ) : activity === "runtime" ? (
                <div className="space-y-1 font-mono text-[11px] text-zinc-400">
                  {functions.map((f) => <div key={f} className="rounded bg-black px-2 py-1">{f}</div>)}
                </div>
              ) : (
                visibleFiles.map((file) => (
                  <button
                    key={file.path}
                    title={file.path}
                    onClick={() => void openFile(file.path)}
                    className={[
                      "block w-full truncate rounded px-2 py-1.5 text-left text-xs",
                      selected === file.path ? "bg-emerald-950 text-emerald-100" : "text-zinc-300 hover:bg-zinc-900",
                    ].join(" ")}
                  >
                    <span className="mr-2 text-zinc-600">{buffers[file.path]?.dirty ? "●" : "·"}</span>
                    {relpath(file.path, root)}
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="grid min-h-0 grid-rows-[34px_minmax(0,1fr)_260px]">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2">
              {openOrder.length === 0 ? (
                <span className="text-xs text-zinc-600">Open a real source file.</span>
              ) : (
                openOrder.map((path) => (
                  <button
                    key={path}
                    onClick={() => setSelected(path)}
                    className={[
                      "h-7 max-w-72 truncate rounded px-3 text-xs",
                      selected === path ? "bg-zinc-800 text-zinc-100" : "bg-black text-zinc-400 hover:bg-zinc-900",
                    ].join(" ")}
                    title={path}
                  >
                    {buffers[path]?.dirty ? "● " : ""}
                    {basename(path)}
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
                    const text = value ?? "";
                    setBuffers((prev) => {
                      const cur = prev[current.path];
                      if (!cur) return prev;
                      return { ...prev, [current.path]: { ...cur, content: text, dirty: text !== cur.original } };
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
                  {["terminal", "output", "problems", "patch", "raw"].map((tab) => (
                    <button key={tab} onClick={() => setBottomTab(tab)} className={bottomTab === tab ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-300"}>{tab}</button>
                  ))}
                </div>
                <button onClick={() => setBottomTab("terminal")} className="text-xs text-zinc-500">Bottom</button>
              </div>

              {bottomTab === "terminal" && (
                <div className="grid h-[calc(100%-32px)] grid-rows-[34px_minmax(0,1fr)]">
                  <div className="flex gap-2 p-2">
                    <input
                      value={terminalCommand}
                      onChange={(e) => setTerminalCommand(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs outline-none focus:border-emerald-700"
                    />
                    <button onClick={() => void runCommand(terminalCommand)} className="rounded bg-zinc-800 px-4 text-xs hover:bg-zinc-700">Run</button>
                  </div>
                  <pre className="overflow-auto px-3 pb-3 font-mono text-xs leading-5 text-zinc-300">
{JSON.stringify(terminalOutput, null, 2)}
                  </pre>
                </div>
              )}

              {bottomTab === "output" && <pre className="h-[calc(100%-32px)] overflow-auto p-3 font-mono text-xs text-zinc-300">{logs.join("\n")}</pre>}
              {bottomTab === "problems" && (
                <div className="h-[calc(100%-32px)] overflow-auto p-3 text-xs">
                  {problems.length === 0 ? <div className="text-zinc-500">No problems parsed.</div> : problems.map((p, i) => (
                    <div key={i} className="mb-2 rounded border border-zinc-900 bg-zinc-950 p-2">
                      <div className={p.severity === "error" ? "text-red-300" : "text-yellow-300"}>{p.severity.toUpperCase()}</div>
                      <div className="font-mono text-zinc-400">{p.file ?? ""}{p.line ? `:${p.line}:${p.column ?? 1}` : ""}</div>
                      <div>{p.message}</div>
                    </div>
                  ))}
                </div>
              )}
              {bottomTab === "patch" && <pre className="h-[calc(100%-32px)] overflow-auto p-3 font-mono text-xs text-zinc-300">{currentPatch}</pre>}
              {bottomTab === "raw" && <pre className="h-[calc(100%-32px)] overflow-auto p-3 font-mono text-xs text-zinc-300">{JSON.stringify(snapshots, null, 2)}</pre>}
            </div>
          </section>

          <aside className="grid min-h-0 grid-rows-[36px_minmax(0,1fr)] border-l border-zinc-800 bg-zinc-950">
            <div className="flex items-center gap-3 overflow-x-auto border-b border-zinc-800 px-2 text-xs">
              {["inspector", "outline", "problems", "patch", "agent", "runtime"].map((tab) => (
                <button key={tab} onClick={() => setRightTab(tab)} className={rightTab === tab ? "rounded bg-zinc-800 px-2 py-1 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}>{tab}</button>
              ))}
            </div>

            <div className="min-h-0 overflow-auto p-3 text-xs">
              {rightTab === "inspector" && (
                <div className="space-y-3">
                  <div className="rounded border border-zinc-800 bg-black p-3">
                    <div className="text-zinc-500">Current file</div>
                    <div className="mt-1 break-all font-mono text-emerald-300">{current ? relpath(current.path, root) : "none"}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-zinc-800 bg-black p-3"><div className="text-zinc-500">entries</div><div className="text-lg">{entries.length}</div></div>
                    <div className="rounded border border-zinc-800 bg-black p-3"><div className="text-zinc-500">files</div><div className="text-lg">{rankFiles(entries).length}</div></div>
                    <div className="rounded border border-zinc-800 bg-black p-3"><div className="text-zinc-500">open</div><div className="text-lg">{openOrder.length}</div></div>
                    <div className="rounded border border-zinc-800 bg-black p-3"><div className="text-zinc-500">dirty</div><div className="text-lg">{dirtyCount}</div></div>
                  </div>
                  <button disabled={!current?.dirty} onClick={() => current && setBuffers((prev) => ({ ...prev, [current.path]: { ...current, content: current.original, dirty: false } }))} className="w-full rounded bg-zinc-800 px-3 py-2 disabled:opacity-40">Revert current</button>
                </div>
              )}

              {rightTab === "outline" && (
                <div className="space-y-2">
                  {currentOutline.length === 0 ? <div className="text-zinc-500">No symbols.</div> : currentOutline.map((o) => (
                    <div key={`${o.line}:${o.name}`} className="rounded border border-zinc-900 bg-black p-2">
                      <div className="text-emerald-300">{o.kind}</div>
                      <div className="font-mono text-zinc-300">{o.name}</div>
                      <div className="text-zinc-600">line {o.line}</div>
                    </div>
                  ))}
                </div>
              )}

              {rightTab === "problems" && (
                <div className="space-y-2">
                  {problems.length === 0 ? <div className="text-zinc-500">No problems.</div> : problems.map((p, i) => (
                    <div key={i} className="rounded border border-zinc-900 bg-black p-2">
                      <div className={p.severity === "error" ? "text-red-300" : "text-yellow-300"}>{p.severity}</div>
                      <div className="font-mono text-zinc-400">{p.file ?? ""}{p.line ? `:${p.line}` : ""}</div>
                      <div>{p.message}</div>
                    </div>
                  ))}
                </div>
              )}

              {rightTab === "patch" && <pre className="whitespace-pre-wrap rounded border border-zinc-900 bg-black p-3 font-mono text-[11px] text-zinc-300">{currentPatch}</pre>}

              {rightTab === "agent" && (
                <div className="space-y-3">
                  <textarea
                    value={agentIntent}
                    onChange={(e) => setAgentIntent(e.target.value)}
                    className="h-32 w-full rounded border border-zinc-700 bg-black p-3 outline-none focus:border-emerald-700"
                  />
                  <button onClick={() => void writeAgentHandoff()} className="w-full rounded bg-emerald-900 px-3 py-2 hover:bg-emerald-800">Write real handoff file</button>
                  <button onClick={() => navigator.clipboard?.writeText(JSON.stringify({ root, current: current?.path, intent: agentIntent }, null, 2))} className="w-full rounded bg-zinc-800 px-3 py-2 hover:bg-zinc-700">Copy context</button>
                  <pre className="max-h-[520px] overflow-auto rounded border border-zinc-800 bg-black p-3 font-mono text-[11px] text-zinc-400">
{[
  "ADJUTORIX_NATIVE_AGENT_CONTEXT",
  `ROOT=${root ?? ""}`,
  `DIRTY_FILES=${Object.values(buffers).filter((b) => b.dirty).map((b) => relpath(b.path, root)).join(",") || "none"}`,
  `INTENT=${agentIntent}`,
  `CURRENT_FILE=${current ? relpath(current.path, root) : "none"}`,
  "",
  (current?.content ?? "").slice(0, 12000),
].join("\n")}
                  </pre>
                </div>
              )}

              {rightTab === "runtime" && (
                <div className="space-y-3">
                  <div className="rounded border border-zinc-800 bg-black p-3">
                    <div className="text-zinc-500">Detected bridge functions</div>
                    <div className="text-xl text-emerald-300">{functions.length}</div>
                  </div>
                  <div className="space-y-1 font-mono text-[11px] text-zinc-400">
                    {functions.map((f) => <div key={f} className="rounded bg-black px-2 py-1">{f}</div>)}
                  </div>
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type command or file..."
              className="mb-3 w-full rounded border border-zinc-700 bg-black px-4 py-3 text-sm outline-none focus:border-emerald-700"
            />
            <div className="max-h-[520px] overflow-auto">
              {paletteItems.slice(0, 80).map((item, i) => (
                <button
                  key={`${item.kind}:${item.label}:${i}`}
                  onClick={() => {
                    setPaletteOpen(false);
                    item.run();
                  }}
                  className="flex w-full justify-between rounded px-3 py-2 text-left text-sm hover:bg-zinc-900"
                >
                  <span className="truncate">{item.label}</span>
                  <span className="ml-4 text-xs text-zinc-500">{item.kind}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
